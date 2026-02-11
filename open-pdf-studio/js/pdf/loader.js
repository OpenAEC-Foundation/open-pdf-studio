import { state, getActiveDocument } from '../core/state.js';
import { placeholder, pdfContainer, fileInfo } from '../ui/dom-elements.js';
import { showLoading, hideLoading } from '../ui/chrome/dialogs.js';
import { updateAllStatus } from '../ui/chrome/status-bar.js';
import { renderPage, setViewMode } from './renderer.js';
import { createAnnotation } from '../annotations/factory.js';
import { generateImageId } from '../utils/helpers.js';
import { colorArrayToHex } from '../utils/colors.js';
import { generateThumbnails, refreshActiveTab } from '../ui/panels/left-panel.js';
import { createTab, updateWindowTitle } from '../ui/chrome/tabs.js';
import * as pdfjsLib from 'pdfjs-dist';
import { isTauri, readBinaryFile, openFileDialog, lockFile } from '../core/platform.js';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } from 'pdf-lib';
import { resetAnnotationStorage } from './form-layer.js';

// Cache for original PDF bytes (used by saver to avoid re-reading)
const originalBytesCache = new Map(); // filePath -> Uint8Array

export function getCachedPdfBytes(filePath) {
  return originalBytesCache.get(filePath);
}

export function setCachedPdfBytes(filePath, bytes) {
  originalBytesCache.set(filePath, bytes);
}

export function clearCachedPdfBytes(filePath) {
  if (filePath) {
    originalBytesCache.delete(filePath);
  } else {
    originalBytesCache.clear();
  }
}

// Set worker source (path relative to HTML file, not this module)
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href;

// Load PDF from file path
export async function loadPDF(filePath) {
  try {
    showLoading('Loading PDF...');

    let typedArray;

    if (isTauri()) {
      // Lock the file to prevent other apps from writing while we have it open
      await lockFile(filePath);

      // Read file using Tauri fs plugin
      const data = await readBinaryFile(filePath);
      typedArray = new Uint8Array(data);

      // Cache a copy of original bytes for saver (pdf.js transfers the buffer
      // to a web worker, which detaches the original Uint8Array making it length 0)
      originalBytesCache.set(filePath, typedArray.slice());
    } else {
      // Fallback for browser environment (e.g., via fetch for local dev)
      throw new Error('File system access not available');
    }

    // Load PDF using pdf.js (this transfers the buffer to a worker)
    state.pdfDoc = await pdfjsLib.getDocument({ data: typedArray }).promise;
    state.currentPdfPath = filePath;

    // Reset form field annotation storage for the new document
    resetAnnotationStorage();

    // Reset annotation state
    state.annotations = [];
    const doc = state.documents[state.activeDocumentIndex];
    if (doc) { doc.undoStack = []; doc.redoStack = []; }
    state.selectedAnnotation = null;
    state.currentPage = 1;

    // Load existing annotations from PDF
    await loadExistingAnnotations();

    // Show PDF container, hide placeholder
    placeholder.style.display = 'none';
    pdfContainer.classList.add('visible');

    // Show PDF controls in status bar
    const pdfControls = document.getElementById('pdf-controls');
    if (pdfControls) pdfControls.style.display = 'flex';

    // Update file info
    const fileName = filePath.split(/[\\/]/).pop();
    fileInfo.textContent = fileName;

    // Render first page
    await setViewMode(state.viewMode);

    // Generate thumbnails for left panel
    generateThumbnails();

    // Refresh active left panel tab (e.g. attachments, layers, etc.)
    refreshActiveTab();

    // Update status bar
    updateAllStatus();

    // Update window title
    updateWindowTitle();

  } catch (error) {
    console.error('Error loading PDF:', error);
    alert('Failed to load PDF: ' + error.message);
  } finally {
    hideLoading();
  }
}

// Open file dialog and load PDF
export async function openPDFFile() {
  if (!isTauri()) {
    console.warn('File dialogs require Tauri environment');
    return;
  }

  try {
    const result = await openFileDialog();
    if (result) {
      // Create a new tab for the file (will switch to existing tab if already open)
      createTab(result);
      await loadPDF(result);
    }
  } catch (error) {
    console.error('Error opening file dialog:', error);
  }
}

// Load existing annotations from PDF
export async function loadExistingAnnotations() {
  if (!state.pdfDoc) return;

  for (let pageNum = 1; pageNum <= state.pdfDoc.numPages; pageNum++) {
    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1 }); // Use scale 1 for coordinate conversion
    const annotations = await page.getAnnotations();

    // Extract extra annotation data from PDF structure using pdf-lib
    const stampAnnots = annotations.filter(a => a.subtype === 'Stamp');
    const needsExtraData = annotations.some(a => ['FreeText', 'Square', 'Circle', 'Line', 'PolyLine', 'Polygon', 'Ink', 'Text', 'Highlight', 'Underline', 'StrikeOut', 'Squiggly'].includes(a.subtype));
    let stampImageMap = null;
    let annotColorMap = null;
    if (stampAnnots.length > 0 || needsExtraData) {
      const pdfBytes = originalBytesCache.get(state.currentPdfPath);
      if (pdfBytes) {
        const pdfLibDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
        if (stampAnnots.length > 0) {
          stampImageMap = await extractStampImages(pageNum, pdfLibDoc);
        }
        if (needsExtraData) {
          annotColorMap = await extractAnnotationColors(pageNum, pdfLibDoc);
        }
      }
    }

    for (const annot of annotations) {
      const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
      if (converted) {
        state.annotations.push(converted);
      }
    }
  }
}

// Map PDF internal font name to CSS font family, and extract bold/italic style info
// Returns { family, bold, italic } or null
function mapPdfFontName(pdfName) {
  if (!pdfName) return null;
  // Remove leading slash if present
  const name = pdfName.replace(/^\//, '');

  // Skip pure reference names like "F1", "F8", "Ff12" - these are not real font names
  if (/^[Ff]\d+$/.test(name)) return null;

  // Common PDF standard font mappings
  const fontMap = {
    'Helv': { family: 'Helvetica' },
    'HeBo': { family: 'Helvetica', bold: true },
    'Helvetica': { family: 'Helvetica' },
    'Helvetica-Bold': { family: 'Helvetica', bold: true },
    'Helvetica-Oblique': { family: 'Helvetica', italic: true },
    'Helvetica-BoldOblique': { family: 'Helvetica', bold: true, italic: true },
    'Cour': { family: 'Courier New' },
    'Courier': { family: 'Courier New' },
    'Courier-Bold': { family: 'Courier New', bold: true },
    'Courier-Oblique': { family: 'Courier New', italic: true },
    'Courier-BoldOblique': { family: 'Courier New', bold: true, italic: true },
    'TiRo': { family: 'Times New Roman' },
    'Times': { family: 'Times New Roman' },
    'Times-Roman': { family: 'Times New Roman' },
    'Times-Bold': { family: 'Times New Roman', bold: true },
    'Times-Italic': { family: 'Times New Roman', italic: true },
    'Times-BoldItalic': { family: 'Times New Roman', bold: true, italic: true },
    'Symbol': { family: 'Symbol' },
    'ZapfDingbats': { family: 'ZapfDingbats' },
    'ZaDb': { family: 'ZapfDingbats' },
    'Arial': { family: 'Arial' },
    'ArialMT': { family: 'Arial' },
    'Arial-BoldMT': { family: 'Arial', bold: true },
    'Arial-ItalicMT': { family: 'Arial', italic: true },
    'Arial-BoldItalicMT': { family: 'Arial', bold: true, italic: true },
  };

  if (fontMap[name]) return fontMap[name];

  // Try to extract base font family from composite names like "SegoeUI-Bold", "ABCDEF+SegoeUI"
  let cleaned = name;
  // Remove subset prefix (e.g., "ABCDEF+")
  cleaned = cleaned.replace(/^[A-Z]{6}\+/, '');

  // Detect bold/italic from style suffixes before removing them
  const stylePart = cleaned.match(/[-,](Bold|Italic|Regular|Light|Medium|Semibold|SemiBold|Thin|ExtraBold|Black|Oblique|BoldItalic|BoldOblique|It)+$/i);
  let bold = false, italic = false;
  if (stylePart) {
    const s = stylePart[0].toLowerCase();
    bold = /bold|black|extrabold/i.test(s);
    italic = /italic|oblique|(?:^|-)it$/i.test(s);
  }

  // Remove style suffixes
  cleaned = cleaned.replace(/[-,](Bold|Italic|Regular|Light|Medium|Semibold|SemiBold|Thin|ExtraBold|Black|Oblique|BoldItalic|BoldOblique|It)+$/i, '');

  // Insert spaces before capitals for CamelCase names (e.g., "SegoeUI" → "Segoe UI")
  const spaced = cleaned.replace(/([a-z])([A-Z])/g, '$1 $2');

  return spaced ? { family: spaced, bold, italic } : null;
}

// Helper to map PDF.js borderStyle.style to our border style string
// PDF.js values: 1=SOLID, 2=DASHED, 3=BEVELED, 4=INSET, 5=UNDERLINE
function mapBorderStyle(annot) {
  const style = annot.borderStyle?.style;
  if (style === 2) return 'dashed';
  if (style === 3 || style === 4) return 'dotted';
  return 'solid';
}

// Helper to get number from pdf-lib PDFNumber
function pdfNum(obj) {
  if (!obj) return null;
  if (typeof obj === 'number') return obj;
  if (typeof obj.numberValue === 'number') return obj.numberValue;
  if (typeof obj.asNumber === 'function') return obj.asNumber();
  return null;
}

// Decompress zlib/deflate data using Web Streams API
async function inflateBytes(compressed) {
  try {
    const ds = new DecompressionStream('deflate');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    writer.write(compressed);
    writer.close();
    const chunks = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    let total = 0;
    for (const c of chunks) total += c.length;
    const result = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) { result.set(c, offset); offset += c.length; }
    return result;
  } catch (e) {
    // Try raw deflate (no zlib header)
    try {
      const ds = new DecompressionStream('raw');
      const writer = ds.writable.getWriter();
      const reader = ds.readable.getReader();
      writer.write(compressed);
      writer.close();
      const chunks = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      let total = 0;
      for (const c of chunks) total += c.length;
      const result = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) { result.set(c, offset); offset += c.length; }
      return result;
    } catch (e2) {
      return null;
    }
  }
}

// Convert pdf-lib color array to hex
function pdfColorToHex(colorArray, context) {
  if (!colorArray || typeof colorArray.size !== 'function' || colorArray.size() < 3) return null;
  const r = pdfNum(colorArray.get(0)), g = pdfNum(colorArray.get(1)), b = pdfNum(colorArray.get(2));
  if (r === null || g === null || b === null) return null;
  return `#${Math.round(r * 255).toString(16).padStart(2, '0')}${Math.round(g * 255).toString(16).padStart(2, '0')}${Math.round(b * 255).toString(16).padStart(2, '0')}`;
}

// Extract colors (IC, appearance stream) from annotations using pdf-lib
// Returns Map<rectKey, { ic, apStrokeColor }> where ic = Interior Color hex, apStrokeColor = stroke from appearance stream
async function extractAnnotationColors(pageNum, pdfDoc) {
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

// Extract stamp images from PDF using pdf-lib
async function extractStampImages(pageNum, pdfDoc) {
  const imageMap = new Map();

  try {
    const page = pdfDoc.getPages()[pageNum - 1];
    if (!page) return imageMap;

    const context = pdfDoc.context;
    const annotsRaw = page.node.get(PDFName.of('Annots'));
    if (!annotsRaw) return imageMap;
    const annots = context.lookup(annotsRaw);
    if (!annots) return imageMap;

    for (let i = 0; i < annots.size(); i++) {
      const annotDict = context.lookup(annots.get(i));
      if (!annotDict) continue;

      const subtype = annotDict.get(PDFName.of('Subtype'));
      if (!subtype || subtype.toString() !== '/Stamp') continue;

      // Get appearance: /AP -> /N
      const apRaw = annotDict.get(PDFName.of('AP'));
      if (!apRaw) { console.warn('Stamp has no /AP'); continue; }
      const apDict = context.lookup(apRaw);
      if (!apDict) continue;

      const normalRaw = apDict.get(PDFName.of('N'));
      if (!normalRaw) { console.warn('Stamp has no /AP/N'); continue; }
      const normalStream = context.lookup(normalRaw);
      if (!normalStream) continue;

      // Extract image from the Form XObject
      const dataUrl = await extractImageFromFormXObject(context, normalStream);
      if (dataUrl) {
        // Build rect key for matching with pdf.js annotations
        const rectArr = annotDict.get(PDFName.of('Rect'));
        if (rectArr) {
          const r0 = pdfNum(context.lookup(rectArr.get(0)) || rectArr.get(0));
          const r1 = pdfNum(context.lookup(rectArr.get(1)) || rectArr.get(1));
          const r2 = pdfNum(context.lookup(rectArr.get(2)) || rectArr.get(2));
          const r3 = pdfNum(context.lookup(rectArr.get(3)) || rectArr.get(3));
          imageMap.set(`${r0},${r1},${r2},${r3}`, dataUrl);
        }
      }
    }
  } catch (e) {
    console.warn('Failed to extract stamp images:', e);
  }

  return imageMap;
}

// Extract the first image from a Form XObject's resources
async function extractImageFromFormXObject(context, formStream) {
  try {
    const dict = formStream.dict || formStream;

    // Check if this IS an image directly
    const subtype = dict.get(PDFName.of('Subtype'));
    if (subtype && subtype.toString() === '/Image') {
      return await decodeImageStream(context, formStream);
    }

    // It's a Form XObject - dig into Resources/XObject to find images
    const resRaw = dict.get(PDFName.of('Resources'));
    if (!resRaw) { console.warn('Form XObject has no /Resources'); return null; }
    const resDict = context.lookup(resRaw);
    if (!resDict) return null;

    const xobjRaw = resDict.get(PDFName.of('XObject'));
    if (!xobjRaw) { console.warn('Resources has no /XObject'); return null; }
    const xobjDict = context.lookup(xobjRaw);
    if (!xobjDict) return null;

    // Iterate XObject entries looking for images
    const entries = xobjDict.entries();
    for (const [name, ref] of entries) {
      const obj = context.lookup(ref);
      if (!obj) continue;
      const innerDict = obj.dict || obj;
      const innerSubtype = innerDict.get(PDFName.of('Subtype'));
      if (innerSubtype && innerSubtype.toString() === '/Image') {
        const result = await decodeImageStream(context, obj);
        if (result) return result;
      }
      // Could be a nested Form XObject containing an image
      if (innerSubtype && innerSubtype.toString() === '/Form') {
        const result = await extractImageFromFormXObject(context, obj);
        if (result) return result;
      }
    }
  } catch (e) {
    console.warn('extractImageFromFormXObject error:', e);
  }
  return null;
}

// Decode an image stream to a data URL
async function decodeImageStream(context, streamObj) {
  try {
    const dict = streamObj.dict || streamObj;
    const width = pdfNum(dict.get(PDFName.of('Width')));
    const height = pdfNum(dict.get(PDFName.of('Height')));
    if (!width || !height) { console.warn('Image has no width/height', width, height); return null; }

    // Get filter
    let filterRaw = dict.get(PDFName.of('Filter'));
    if (filterRaw) filterRaw = context.lookup(filterRaw) || filterRaw;
    let filter = '';
    if (filterRaw) {
      // Filter could be a name or an array of names
      if (typeof filterRaw.toString === 'function') {
        const s = filterRaw.toString();
        if (s.startsWith('/')) {
          filter = s;
        } else if (s.startsWith('[')) {
          // Array of filters - get the last one (innermost encoding)
          const match = s.match(/\/(\w+)/g);
          if (match && match.length > 0) filter = match[match.length - 1];
        }
      }
    }

    // Get raw stream bytes
    const rawBytes = streamObj.contents;
    if (!rawBytes || rawBytes.length === 0) { console.warn('Image stream is empty'); return null; }

    // Check for SMask (transparency mask)
    const sMaskRef = dict.get(PDFName.of('SMask'));
    let sMaskBytes = null;
    if (sMaskRef) {
      try {
        const sMaskStream = context.lookup(sMaskRef);
        if (sMaskStream && sMaskStream.contents) {
          sMaskBytes = sMaskStream.contents;
          const sMaskFilter = sMaskStream.dict?.get(PDFName.of('Filter'))?.toString();
          if (sMaskFilter === '/FlateDecode') {
            sMaskBytes = await inflateBytes(sMaskBytes) || sMaskBytes;
          }
        }
      } catch (e) { /* ignore smask errors */ }
    }

    // JPEG - decode to canvas so we can apply SMask transparency
    if (filter === '/DCTDecode') {
      const blob = new Blob([rawBytes], { type: 'image/jpeg' });
      const jpegUrl = await blobToDataUrl(blob);

      // If no SMask, just return the JPEG directly
      if (!sMaskBytes) return jpegUrl;

      // Apply SMask: load JPEG onto canvas, then set alpha from SMask
      const jpegImg = await loadImage(jpegUrl);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(jpegImg, 0, 0, width, height);
      const imgData = ctx.getImageData(0, 0, width, height);
      const px = imgData.data;
      for (let i = 0, j = 3; i < sMaskBytes.length && j < px.length; i++, j += 4) {
        px[j] = sMaskBytes[i];
      }
      ctx.putImageData(imgData, 0, 0);
      return canvas.toDataURL('image/png');
    }

    // JPEG2000
    if (filter === '/JPXDecode') {
      const blob = new Blob([rawBytes], { type: 'image/jp2' });
      if (!sMaskBytes) return await blobToDataUrl(blob);

      const jp2Url = await blobToDataUrl(blob);
      const jp2Img = await loadImage(jp2Url);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(jp2Img, 0, 0, width, height);
      const imgData = ctx.getImageData(0, 0, width, height);
      const px = imgData.data;
      for (let i = 0, j = 3; i < sMaskBytes.length && j < px.length; i++, j += 4) {
        px[j] = sMaskBytes[i];
      }
      ctx.putImageData(imgData, 0, 0);
      return canvas.toDataURL('image/png');
    }

    // FlateDecode - decompress then decode pixels
    let imageBytes = rawBytes;
    if (filter === '/FlateDecode') {
      const decompressed = await inflateBytes(rawBytes);
      if (!decompressed) { console.warn('Failed to decompress FlateDecode stream'); return null; }
      imageBytes = decompressed;
    }

    // Get color space
    let colorSpace = '';
    const csRaw = dict.get(PDFName.of('ColorSpace'));
    if (csRaw) {
      const cs = context.lookup(csRaw) || csRaw;
      colorSpace = cs.toString();
    }

    // Decode raw pixels to canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(width, height);
    const px = imgData.data;

    if (colorSpace.includes('DeviceGray') || colorSpace.includes('CalGray')) {
      for (let i = 0, j = 0; i < imageBytes.length && j < px.length; i++, j += 4) {
        px[j] = px[j+1] = px[j+2] = imageBytes[i];
        px[j+3] = 255;
      }
    } else if (colorSpace.includes('CMYK')) {
      for (let i = 0, j = 0; i < imageBytes.length - 3 && j < px.length; i += 4, j += 4) {
        const c = imageBytes[i]/255, m = imageBytes[i+1]/255, y = imageBytes[i+2]/255, k = imageBytes[i+3]/255;
        px[j] = 255*(1-c)*(1-k); px[j+1] = 255*(1-m)*(1-k); px[j+2] = 255*(1-y)*(1-k); px[j+3] = 255;
      }
    } else {
      // Default: RGB
      for (let i = 0, j = 0; i < imageBytes.length - 2 && j < px.length; i += 3, j += 4) {
        px[j] = imageBytes[i]; px[j+1] = imageBytes[i+1]; px[j+2] = imageBytes[i+2]; px[j+3] = 255;
      }
    }

    // Apply SMask (transparency) if present
    if (sMaskBytes) {
      for (let i = 0, j = 3; i < sMaskBytes.length && j < px.length; i++, j += 4) {
        px[j] = sMaskBytes[i];
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas.toDataURL('image/png');
  } catch (e) {
    console.warn('decodeImageStream error:', e);
    return null;
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// Convert PDF annotation to our format
async function convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap) {
  const pageHeight = viewport.height;

  // Helper to convert Y coordinate
  const convertY = (pdfY) => pageHeight - pdfY;

  // Helper to parse PDF dates (format: D:YYYYMMDDHHmmSS or similar)
  const parsePdfDate = (pdfDate) => {
    if (!pdfDate) return new Date().toISOString();
    try {
      // Handle PDF date format D:YYYYMMDDHHmmSS
      if (typeof pdfDate === 'string' && pdfDate.startsWith('D:')) {
        const dateStr = pdfDate.substring(2);
        const year = dateStr.substring(0, 4);
        const month = dateStr.substring(4, 6) || '01';
        const day = dateStr.substring(6, 8) || '01';
        const hour = dateStr.substring(8, 10) || '00';
        const min = dateStr.substring(10, 12) || '00';
        const sec = dateStr.substring(12, 14) || '00';
        return new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`).toISOString();
      }
      // Try direct parsing
      const date = new Date(pdfDate);
      if (isNaN(date.getTime())) return new Date().toISOString();
      return date.toISOString();
    } catch {
      return new Date().toISOString();
    }
  };

  // Get common properties
  const rect = annot.rect;
  if (!rect || rect.length < 4) return null;

  // Look up extra colors extracted via pdf-lib (IC entry, appearance stream colors)
  const rectKey = `${rect[0]},${rect[1]},${rect[2]},${rect[3]}`;
  const extraColors = annotColorMap?.get(rectKey) || {};

  const baseProps = {
    page: pageNum,
    author: annot.title || 'User',
    subject: annot.subject || '',
    createdAt: parsePdfDate(annot.creationDate),
    modifiedAt: parsePdfDate(annot.modificationDate),
    opacity: annot.opacity !== undefined ? annot.opacity : (extraColors.opacity !== undefined ? extraColors.opacity : 1.0),
    locked: !!(annot.annotationFlags & 128),      // Bit 8: Locked
    printable: !!(annot.annotationFlags & 4),       // Bit 3: Print
    readOnly: !!(annot.annotationFlags & 64),       // Bit 7: ReadOnly
    marked: false
  };

  switch (annot.subtype) {
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut':
    case 'Squiggly': {
      // Map PDF subtype to our type
      const typeMap = {
        'Highlight': 'textHighlight',
        'Underline': 'textUnderline',
        'StrikeOut': 'textStrikethrough',
        'Squiggly': 'textSquiggly'
      };
      const markupType = typeMap[annot.subtype] || 'highlight';

      // Extract rects from quadPoints for per-line markup
      const rects = [];
      if (annot.quadPoints && annot.quadPoints.length >= 8) {
        for (let i = 0; i < annot.quadPoints.length; i += 8) {
          const xs = [annot.quadPoints[i], annot.quadPoints[i+2], annot.quadPoints[i+4], annot.quadPoints[i+6]];
          const ys = [annot.quadPoints[i+1], annot.quadPoints[i+3], annot.quadPoints[i+5], annot.quadPoints[i+7]];
          const qMinX = Math.min(...xs);
          const qMaxX = Math.max(...xs);
          const qMinY = Math.min(...ys);
          const qMaxY = Math.max(...ys);
          rects.push({ x: qMinX, y: convertY(qMaxY), width: qMaxX - qMinX, height: qMaxY - qMinY });
        }
      }

      // Calculate overall bounding box
      let minX, maxX, minY, maxY;
      if (rects.length > 0) {
        minX = Math.min(...rects.map(r => r.x));
        maxX = Math.max(...rects.map(r => r.x + r.width));
        minY = Math.min(...rects.map(r => r.y));
        maxY = Math.max(...rects.map(r => r.y + r.height));
      } else {
        minX = rect[0];
        maxX = rect[2];
        minY = convertY(rect[3]);
        maxY = convertY(rect[1]);
      }

      return createAnnotation({
        ...baseProps,
        type: markupType,
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        rects: rects.length > 0 ? rects : undefined,
        color: colorArrayToHex(annot.color, '#FFFF00'),
        fillColor: colorArrayToHex(annot.color, '#FFFF00')
      });
    }

    case 'Square':
      return createAnnotation({
        ...baseProps,
        type: 'box',
        x: rect[0],
        y: convertY(rect[3]),
        width: rect[2] - rect[0],
        height: rect[3] - rect[1],
        color: colorArrayToHex(annot.color, '#000000'),
        strokeColor: colorArrayToHex(annot.color, '#000000'),
        fillColor: extraColors.ic || null,
        lineWidth: annot.borderStyle?.width || 2,
        borderStyle: mapBorderStyle(annot)
      });

    case 'Circle':
      return createAnnotation({
        ...baseProps,
        type: 'circle',
        x: rect[0],
        y: convertY(rect[3]),
        width: rect[2] - rect[0],
        height: rect[3] - rect[1],
        color: colorArrayToHex(annot.color, '#000000'),
        strokeColor: colorArrayToHex(annot.color, '#000000'),
        fillColor: extraColors.ic || null,
        lineWidth: annot.borderStyle?.width || 2,
        borderStyle: mapBorderStyle(annot)
      });

    case 'Line':
      if (annot.lineCoordinates && annot.lineCoordinates.length >= 4) {
        // Check for line endings (arrow heads)
        const le = annot.lineEndings || [];
        const mapPdfHead = (h) => {
          switch (h) {
            case 'OpenArrow': return 'open';
            case 'ClosedArrow': return 'closed';
            case 'Diamond': return 'diamond';
            case 'Circle': return 'circle';
            case 'Square': return 'square';
            case 'Slash': return 'slash';
            case 'Butt': return 'butt';
            default: return 'none';
          }
        };
        const startHead = mapPdfHead(le[0]);
        const endHead = mapPdfHead(le[1]);
        const isArrow = startHead !== 'none' || endHead !== 'none';

        // Use original /L coords from pdf-lib (PDF.js normalizeRect destroys direction)
        const lc = extraColors.lineCoords || annot.lineCoordinates;

        return createAnnotation({
          ...baseProps,
          type: isArrow ? 'arrow' : 'line',
          startX: lc[0],
          startY: convertY(lc[1]),
          endX: lc[2],
          endY: convertY(lc[3]),
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          fillColor: extraColors.ic || undefined,
          lineWidth: annot.borderStyle?.width || 2,
          borderStyle: mapBorderStyle(annot),
          startHead: startHead,
          endHead: endHead,
          headSize: 12
        });
      }
      break;

    case 'Ink':
      // Freehand drawing
      if (annot.inkLists && annot.inkLists.length > 0) {
        const path = [];
        const inkList = annot.inkLists[0];
        for (let i = 0; i < inkList.length; i += 2) {
          path.push({
            x: inkList[i],
            y: convertY(inkList[i + 1])
          });
        }
        return createAnnotation({
          ...baseProps,
          type: 'draw',
          path: path,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          lineWidth: annot.borderStyle?.width || 2,
          borderStyle: mapBorderStyle(annot)
        });
      }
      break;

    case 'PolyLine':
      if (annot.vertices && annot.vertices.length >= 4) {
        const points = [];
        for (let i = 0; i < annot.vertices.length; i += 2) {
          points.push({
            x: annot.vertices[i],
            y: convertY(annot.vertices[i + 1])
          });
        }
        return createAnnotation({
          ...baseProps,
          type: 'polyline',
          points: points,
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          lineWidth: annot.borderStyle?.width || 2,
          borderStyle: mapBorderStyle(annot)
        });
      }
      break;

    case 'Polygon':
      if (annot.vertices && annot.vertices.length >= 6) {
        // Calculate bounding box
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < annot.vertices.length; i += 2) {
          minX = Math.min(minX, annot.vertices[i]);
          maxX = Math.max(maxX, annot.vertices[i]);
          minY = Math.min(minY, annot.vertices[i + 1]);
          maxY = Math.max(maxY, annot.vertices[i + 1]);
        }
        return createAnnotation({
          ...baseProps,
          type: 'polygon',
          x: minX,
          y: convertY(maxY),
          width: maxX - minX,
          height: maxY - minY,
          sides: Math.floor(annot.vertices.length / 2),
          color: colorArrayToHex(annot.color, '#000000'),
          strokeColor: colorArrayToHex(annot.color, '#000000'),
          fillColor: extraColors.ic || null,
          lineWidth: annot.borderStyle?.width || 2,
          borderStyle: mapBorderStyle(annot)
        });
      }
      break;

    case 'Text':
      // Sticky note annotation
      return createAnnotation({
        ...baseProps,
        type: 'comment',
        x: rect[0],
        y: convertY(rect[3]),
        width: 24,
        height: 24,
        text: annot.contents || '',
        color: colorArrayToHex(annot.color, '#FFFF00'),
        fillColor: colorArrayToHex(annot.color, '#FFFF00'),
        icon: annot.name || 'comment'
      });

    case 'FreeText': {
      // Extract font size, font family, bold/italic, and text color
      let fontSize = 14;
      let textColor = '#000000';
      let fontFamily = null;
      let fontBold = false;
      let fontItalic = false;

      if (annot.defaultAppearanceData) {
        if (annot.defaultAppearanceData.fontSize) fontSize = annot.defaultAppearanceData.fontSize;
        if (annot.defaultAppearanceData.fontColor) {
          textColor = colorArrayToHex(annot.defaultAppearanceData.fontColor, '#000000');
        }
        if (annot.defaultAppearanceData.fontName) {
          const fontInfo = mapPdfFontName(annot.defaultAppearanceData.fontName);
          if (fontInfo) {
            fontFamily = fontInfo.family;
            if (fontInfo.bold) fontBold = true;
            if (fontInfo.italic) fontItalic = true;
          }
        }
      }
      if (!fontFamily && annot.defaultAppearance) {
        // Parse DA string "/FontRef size Tf"
        const fontMatch = annot.defaultAppearance.match(/\/([^\s]+)\s+[\d.]+\s+Tf/);
        if (fontMatch) {
          const fontInfo = mapPdfFontName(fontMatch[1]);
          if (fontInfo) {
            fontFamily = fontInfo.family;
            if (fontInfo.bold) fontBold = true;
            if (fontInfo.italic) fontItalic = true;
          }
        }
        if (!annot.defaultAppearanceData) {
          const sizeMatch = annot.defaultAppearance.match(/(\d+(?:\.\d+)?)\s+Tf/);
          if (sizeMatch) fontSize = parseFloat(sizeMatch[1]);
          const colorMatch = annot.defaultAppearance.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+rg/);
          if (colorMatch) {
            textColor = colorArrayToHex([parseFloat(colorMatch[1]), parseFloat(colorMatch[2]), parseFloat(colorMatch[3])], '#000000');
          }
        }
      }
      // Use font info from pdf-lib if available (more accurate - resolves reference names like "F8")
      if (extraColors.fontFamily) fontFamily = extraColors.fontFamily;
      if (extraColors.fontBold) fontBold = true;
      if (extraColors.fontItalic) fontItalic = true;
      let fontUnderline = extraColors.fontUnderline || false;
      let fontStrikethrough = extraColors.fontStrikethrough || false;

      // Text content: prefer textContent array (joined), fallback to contents
      const text = annot.textContent ? annot.textContent.join('\n') : (annot.contents || '');

      // For FreeText annotations, annot.color (C entry) is the background/fill color per PDF spec
      // Border color: IC entry or appearance stream stroke color (extracted via pdf-lib)
      let borderColor = extraColors.ic || extraColors.apStrokeColor || '#000000';
      if (borderColor === '#000000' && annot.borderColor) {
        borderColor = colorArrayToHex(annot.borderColor, '#000000');
      }

      // Fill/background color: annot.color (C entry) for FreeText, fallback to backgroundColor (MK/BG)
      const bgColor = annot.color
        ? colorArrayToHex(annot.color)
        : (annot.backgroundColor ? colorArrayToHex(annot.backgroundColor) : null);

      // Border style: 1=SOLID, 2=DASHED, 3=BEVELED, 4=INSET, 5=UNDERLINE
      const bsStyle = annot.borderStyle?.style;
      const borderStyle = bsStyle === 2 ? 'dashed' : (bsStyle === 3 || bsStyle === 4 ? 'dotted' : 'solid');
      const borderWidth = extraColors.borderWidth !== undefined ? extraColors.borderWidth : (annot.borderStyle?.width || 1);

      // Derive rotation: check /Rotation key first (our format), then AP/N Matrix
      let ftRotation = 0;
      if (extraColors.rotation !== undefined && extraColors.rotation !== 0) {
        ftRotation = Math.round(extraColors.rotation);
      }
      if (ftRotation === 0 && extraColors.matrixAngle !== undefined) {
        const ma = extraColors.matrixAngle;
        const baseAngle = Math.round(ma / 90) * 90;
        ftRotation = -(ma - baseAngle);
        ftRotation = Math.round(ftRotation);
        if (Math.abs(ftRotation) <= 1) ftRotation = 0;
      }

      // Recover the original (unrotated) textbox dimensions from Rect.
      const rectW = rect[2] - rect[0];
      const rectH = rect[3] - rect[1];
      let ftWidth, ftHeight;
      const isStdRot = ftRotation !== 0 && ftRotation % 90 === 0;
      if (isStdRot) {
        // Standard rotation: Rect has original (non-expanded) dimensions
        ftWidth = rectW;
        ftHeight = rectH;
      } else if (ftRotation !== 0) {
        // Arbitrary angle: Rect is the expanded bounding box, recover original dims
        const c = Math.abs(Math.cos(ftRotation * Math.PI / 180));
        const s = Math.abs(Math.sin(ftRotation * Math.PI / 180));
        const det = c * c - s * s;
        if (Math.abs(det) > 0.01) {
          ftWidth = Math.round((rectW * c - rectH * s) / det);
          ftHeight = Math.round((rectH * c - rectW * s) / det);
          if (ftWidth <= 0 || ftHeight <= 0) {
            ftWidth = rectW;
            ftHeight = rectH;
          }
        } else {
          if (extraColors.bboxWidth && extraColors.bboxHeight &&
              (Math.abs(extraColors.bboxWidth - rectW) > 1 || Math.abs(extraColors.bboxHeight - rectH) > 1)) {
            ftWidth = extraColors.bboxWidth;
            ftHeight = extraColors.bboxHeight;
          } else {
            ftWidth = rectW;
            ftHeight = rectH;
          }
        }
      } else {
        ftWidth = rectW;
        ftHeight = rectH;
      }
      // Position: center of the Rect (bounding box center = rotated textbox center)
      const cx = rect[0] + rectW / 2;
      const cy = convertY(rect[3]) + rectH / 2;
      const ftX = cx - ftWidth / 2;
      const ftY = cy - ftHeight / 2;

      const isCallout = annot.calloutLine && annot.calloutLine.length >= 4;

      if (isCallout) {
        return createAnnotation({
          ...baseProps,
          type: 'callout',
          x: ftX,
          y: ftY,
          width: ftWidth,
          height: ftHeight,
          rotation: ftRotation,
          text: text,
          color: borderColor,
          strokeColor: borderColor,
          fillColor: bgColor || '#FFFFD0',
          textColor: textColor,
          fontSize: fontSize,
          borderStyle: borderStyle,
          lineWidth: borderWidth,
          fontFamily: fontFamily || 'Arial',
          fontBold: fontBold,
          fontItalic: fontItalic,
          fontUnderline: fontUnderline,
          fontStrikethrough: fontStrikethrough,
          arrowX: annot.calloutLine[0],
          arrowY: convertY(annot.calloutLine[1]),
          kneeX: annot.calloutLine.length >= 6 ? annot.calloutLine[2] : annot.calloutLine[0],
          kneeY: annot.calloutLine.length >= 6 ? convertY(annot.calloutLine[3]) : convertY(annot.calloutLine[1])
        });
      }

      return createAnnotation({
        ...baseProps,
        type: 'textbox',
        x: ftX,
        y: ftY,
        width: ftWidth,
        height: ftHeight,
        rotation: ftRotation,
        text: text,
        color: borderColor,
        strokeColor: borderColor,
        fillColor: bgColor,
        textColor: textColor,
        fontSize: fontSize,
        borderStyle: borderStyle,
        lineWidth: borderWidth,
        fontFamily: fontFamily || 'Arial',
        fontBold: fontBold,
        fontItalic: fontItalic,
        fontUnderline: fontUnderline,
        fontStrikethrough: fontStrikethrough
      });
    }

    case 'Stamp': {
      // Image stamp - extracted from PDF structure via pdf-lib
      const x = rect[0];
      const y = convertY(rect[3]);
      const w = rect[2] - rect[0];
      const h = rect[3] - rect[1];

      // Find matching stamp image by rect
      let dataUrl = null;
      if (stampImageMap) {
        // Try exact match first
        const key = `${rect[0]},${rect[1]},${rect[2]},${rect[3]}`;
        dataUrl = stampImageMap.get(key);
        // Fuzzy match fallback
        if (!dataUrl) {
          for (const [k, v] of stampImageMap.entries()) {
            const parts = k.split(',').map(Number);
            if (Math.abs(parts[0] - rect[0]) < 1 && Math.abs(parts[1] - rect[1]) < 1 &&
                Math.abs(parts[2] - rect[2]) < 1 && Math.abs(parts[3] - rect[3]) < 1) {
              dataUrl = v;
              break;
            }
          }
        }
      }

      if (dataUrl) {
        const imageId = generateImageId();
        const img = new Image();
        img.src = dataUrl;
        state.imageCache.set(imageId, img);

        return createAnnotation({
          ...baseProps,
          type: 'image',
          x: x,
          y: y,
          width: w,
          height: h,
          imageId: imageId,
          imageData: dataUrl,
          originalWidth: w,
          originalHeight: h,
          rotation: 0
        });
      }
      break;
    }
  }

  return null;
}
