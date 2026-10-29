import { getActiveDocument } from '../../core/state.js';
import { StandardFonts, degrees, rgb } from 'pdf-lib';
import { parsePageRange } from '../exporter.js';
import { schrijfKopVoeten, vindKopVoetIds, leesKopVoetDefinities } from './kopvoet.js';

function titelVan(pdfDocLib) {
  try { return pdfDocLib.getTitle() || ''; } catch { return ''; } // een /Title die geen tekst is
}

/**
 * Kop-/voetteksten (#375): de streams van eerdere saves gaan eruit en de
 * huidige komen er opnieuw in, zodat ze niet bij elke save stapelen. Alleen
 * streams van kop-/voetteksten die het document kent worden vervangen; een
 * onbekende (niet ingelezen bij openen) blijft staan, met zijn definitie.
 * @returns {Promise<string[]>} de ids die nu in het bestand staan
 */
async function saveHeaderFootersToPages(pdfDocLib, doc) {
  const kopVoeten = (doc?.watermarks || []).filter(w => w?.type === 'headerFooter');
  const inBestand = vindKopVoetIds(pdfDocLib);
  const bekend = new Set([...(doc?.kopVoetBekend || []), ...kopVoeten.map(w => w.id)]);
  const onbekend = new Set([...inBestand].filter(id => !bekend.has(id)));
  const { geschreven } = await schrijfKopVoeten(pdfDocLib, kopVoeten, {
    vervang: new Set([...inBestand].filter(id => bekend.has(id))),
    behouden: leesKopVoetDefinities(pdfDocLib).filter(d => onbekend.has(d.id)),
    bestandsnaam: doc?.fileName || '',
    titel: doc?.pdfTitel || titelVan(pdfDocLib),
    paginaBereik: parsePageRange,
  });
  return geschreven;
}

// Save watermarks into PDF pages. Geeft { kopVoet: ids } terug: de
// kop-/voetteksten die nu als pagina-inhoud in het bestand staan.
export async function saveWatermarksToPages(pdfDocLib, pages, doc = getActiveDocument(), { annulering = null } = {}) {
  const kopVoet = await saveHeaderFootersToPages(pdfDocLib, doc);
  const watermarks = (doc?.watermarks || []).filter(w => w?.type !== 'headerFooter');
  if (watermarks.length === 0) return { kopVoet };

  const totalPages = pages.length;

  // Pre-embed fonts
  const fontCache = {};
  async function getFont(fontFamily) {
    if (fontCache[fontFamily]) return fontCache[fontFamily];
    let stdFont;
    const f = (fontFamily || '').toLowerCase();
    if (f.includes('courier')) stdFont = StandardFonts.Courier;
    else if (f.includes('times')) stdFont = StandardFonts.TimesRoman;
    else stdFont = StandardFonts.Helvetica;
    const font = await pdfDocLib.embedFont(stdFont);
    fontCache[fontFamily] = font;
    return font;
  }

  // Pre-embed images
  const imageEmbedCache = {};
  async function getEmbeddedImage(imageData) {
    if (imageEmbedCache[imageData]) return imageEmbedCache[imageData];
    try {
      const base64 = imageData.split(',')[1];
      const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      let embedded;
      if (imageData.startsWith('data:image/jpeg') || imageData.startsWith('data:image/jpg')) {
        embedded = await pdfDocLib.embedJpg(bytes);
      } else {
        embedded = await pdfDocLib.embedPng(bytes);
      }
      imageEmbedCache[imageData] = embedded;
      return embedded;
    } catch (e) {
      console.warn('Failed to embed watermark image:', e);
      return null;
    }
  }

  function shouldRenderOnPage(wm, pageNum) {
    if (!wm.enabled) return false;
    if (wm.pageRange === 'all') return true;
    if (wm.pageRange === 'first') return pageNum === 1;
    if (wm.pageRange === 'custom' && wm.customPages) {
      return parsePageRange(wm.customPages, totalPages).includes(pageNum);
    }
    return true;
  }

  function hexToRgbObj(hex) {
    const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!r) return rgb(0, 0, 0);
    return rgb(parseInt(r[1], 16) / 255, parseInt(r[2], 16) / 255, parseInt(r[3], 16) / 255);
  }

  function getPositionPdf(position, customX, customY, pw, ph, objW, objH) {
    switch (position) {
      case 'center': return { x: (pw - objW) / 2, y: (ph - objH) / 2 };
      case 'top-left': return { x: 40, y: ph - objH - 40 };
      case 'top-right': return { x: pw - objW - 40, y: ph - objH - 40 };
      case 'bottom-left': return { x: 40, y: 40 };
      case 'bottom-right': return { x: pw - objW - 40, y: 40 };
      case 'custom': return { x: customX || (pw - objW) / 2, y: ph - (customY || ph / 2) - objH / 2 };
      default: return { x: (pw - objW) / 2, y: (ph - objH) / 2 };
    }
  }

  // Process 'behind' watermarks first (draw before content by using drawText early),
  // then 'infront' watermarks (draw after content)
  for (const layer of ['behind', 'infront']) {
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      // Veilig punt per pagina: een geannuleerde save stopt hier (#766).
      if (annulering) await annulering.punt();
      const pageNum = pageIndex + 1;
      const page = pages[pageIndex];
      const { width: pw, height: ph } = page.getSize();

      for (const wm of watermarks) {
        if (!wm.enabled) continue;
        if (!shouldRenderOnPage(wm, pageNum)) continue;

        if (wm.type === 'textWatermark' && (wm.layer || 'behind') === layer) {
          const font = await getFont(wm.fontFamily);
          const fontSize = wm.fontSize || 72;
          const text = wm.text || '';
          const textWidth = font.widthOfTextAtSize(text, fontSize);
          const textHeight = fontSize;
          const pos = getPositionPdf(wm.position, wm.customX, wm.customY, pw, ph, textWidth, textHeight);

          page.drawText(text, {
            x: pos.x + textWidth / 2,
            y: pos.y + textHeight / 2,
            size: fontSize,
            font: font,
            color: hexToRgbObj(wm.color || '#ff0000'),
            opacity: wm.opacity !== undefined ? wm.opacity : 0.3,
            rotate: degrees(-(wm.rotation || 0)),
          });
        }

        if (wm.type === 'imageWatermark' && (wm.layer || 'behind') === layer && wm.imageData) {
          const embeddedImg = await getEmbeddedImage(wm.imageData);
          if (!embeddedImg) continue;

          const scale = wm.scale || 1;
          const imgW = (wm.width || 200) * scale;
          const imgH = (wm.height || 200) * scale;
          const pos = getPositionPdf(wm.position, wm.customX, wm.customY, pw, ph, imgW, imgH);

          page.drawImage(embeddedImg, {
            x: pos.x,
            y: pos.y,
            width: imgW,
            height: imgH,
            opacity: wm.opacity !== undefined ? wm.opacity : 0.2,
            rotate: degrees(-(wm.rotation || 0)),
          });
        }
      }
    }
  }
  return { kopVoet };
}
