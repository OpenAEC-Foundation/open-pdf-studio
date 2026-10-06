import { getActiveDocument } from '../../core/state.js';
import { StandardFonts, degrees, rgb } from 'pdf-lib';
import { parsePageRange } from '../exporter.js';

// Save watermarks into PDF pages
export async function saveWatermarksToPages(pdfDocLib, pages, doc = getActiveDocument()) {
  const watermarks = doc?.watermarks;
  if (!watermarks || watermarks.length === 0) return;

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

        if (wm.type === 'headerFooter' && layer === 'infront') {
          const font = await getFont(wm.fontFamily);
          const fontSize = wm.fontSize || 10;
          const color = hexToRgbObj(wm.color || '#000000');
          const mt = wm.marginTop || 30;
          const mb = wm.marginBottom || 30;
          const ml = wm.marginLeft || 40;
          const mr = wm.marginRight || 40;

          const filename = doc ? doc.fileName : '';
          const now = new Date();
          const subst = (t) => (t || '')
            .replace(/\{page\}/g, String(pageNum))
            .replace(/\{pages\}/g, String(totalPages))
            .replace(/\{date\}/g, now.toLocaleDateString())
            .replace(/\{time\}/g, now.toLocaleTimeString())
            .replace(/\{filename\}/g, filename);

          const headerY = ph - mt;
          const footerY = mb;

          const slots = [
            { text: subst(wm.headerLeft), x: ml, y: headerY, align: 'left' },
            { text: subst(wm.headerCenter), x: pw / 2, y: headerY, align: 'center' },
            { text: subst(wm.headerRight), x: pw - mr, y: headerY, align: 'right' },
            { text: subst(wm.footerLeft), x: ml, y: footerY, align: 'left' },
            { text: subst(wm.footerCenter), x: pw / 2, y: footerY, align: 'center' },
            { text: subst(wm.footerRight), x: pw - mr, y: footerY, align: 'right' },
          ];

          for (const slot of slots) {
            if (!slot.text) continue;
            let drawX = slot.x;
            const tw = font.widthOfTextAtSize(slot.text, fontSize);
            if (slot.align === 'center') drawX -= tw / 2;
            else if (slot.align === 'right') drawX -= tw;

            page.drawText(slot.text, {
              x: drawX,
              y: slot.y,
              size: fontSize,
              font: font,
              color: color,
            });
          }
        }
      }
    }
  }
}
