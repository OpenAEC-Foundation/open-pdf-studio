// Tekeningkaders uit de huisstijl van het bedrijf (werkplek van de OpenAEC-site).
//
// Als gast in de werkplek zijn er geen kaders op schijf (pdf/frames.js werkt
// alleen in de desktop-app). De site levert dan de kaders van de huisstijl
// in Beheer via het hostcontract (core/platform.js):
//
//   window.__OPDS_HOST__.huisstijl() -> Promise<{
//     merk: 'Voorbeeldbureau',
//     kaders: [{
//       naam, formaat ('A1'), orientatie ('liggend' | 'staand'),
//       breedte_mm, hoogte_mm, standaard,
//       velden: [{ veld, label, x_mm, y_mm, lettergrootte, uitlijning }],
//       template: { soort: 'svg', bytes } | null,
//       logo: { soort: 'svg' | 'png', bytes, x_mm, y_mm, breedte_mm } | null,
//     }],
//   }>
//
// Maten in mm op papier met de oorsprong linksonder, net als in een PDF. Van
// een kader maakt maakKaderPdf() één vel: het sjabloon over het hele vel, het
// logo op zijn plek en de velden (projectnaam, projectnummer, ...) als
// invulvelden, zodat je ze in Open PDF Studio meteen kunt invullen.

import { PDFDocument, PDFHexString, PDFName, StandardFonts } from 'pdf-lib';
import { gastObject } from '../core/gehost.js';

const PT_PER_MM = 72 / 25.4;
// Een SVG-sjabloon wordt een afbeelding (pdf-lib tekent geen SVG): scherp
// genoeg om op te printen, maar niet groter dan de canvas aankan.
const SJABLOON_DPI = 200;
const MAX_PIXELS = 6000;
const VELD_BREEDTE_MM = 70;

// ISO-maten staand (mm), voor een kader zonder eigen breedte en hoogte.
const ISO_MM = {
  a0: [841, 1189], a1: [594, 841], a2: [420, 594], a3: [297, 420], a4: [210, 297],
};

/** Levert de site huisstijlkaders? */
export function heeftHuisstijl() {
  return typeof gastObject()?.huisstijl === 'function';
}

/** De kaders van de huisstijl, met `merk` en een `id` per kader; [] zonder site of bij een fout. */
export async function laadHuisstijlKaders() {
  if (!heeftHuisstijl()) return [];
  try {
    const uit = await gastObject().huisstijl();
    const merk = String(uit?.merk || '').trim();
    return (Array.isArray(uit?.kaders) ? uit.kaders : [])
      .filter((k) => kaderMaat(k))
      .map((k, i) => ({ ...k, id: `huisstijl:${i}`, merk }));
  } catch (e) {
    console.warn('[huisstijl] kaders niet beschikbaar:', e?.message ?? e);
    return [];
  }
}

// De richting komt van de site als 'liggend' | 'staand'; in de keuzelijst
// staat hij in de taal van de app (newDoc.frameOrientation.*).
const RICHTING = { liggend: 'landscape', landscape: 'landscape', staand: 'portrait', portrait: 'portrait' };

function richtingLabel(orientatie, t) {
  const sleutel = RICHTING[String(orientatie || '').toLowerCase()];
  if (sleutel && typeof t === 'function') return t(`newDoc.frameOrientation.${sleutel}`);
  return orientatie || '';
}

/** De naam in de keuzelijst: "Voorbeeldbureau – Tekening A1 (liggend)". `t` (dialogs) vertaalt de richting. */
export function kaderLabel(kader, t = null) {
  const richting = richtingLabel(kader.orientatie, t);
  const maat = [kader.formaat, richting && `(${richting})`].filter(Boolean).join(' ');
  const naam = [kader.naam, maat].filter(Boolean).join(' ');
  return kader.merk ? `${kader.merk} – ${naam}` : naam;
}

/** Breedte en hoogte van het vel in mm, of null. */
export function kaderMaat(kader) {
  let b = Number(kader?.breedte_mm);
  let h = Number(kader?.hoogte_mm);
  if (!(b > 0 && h > 0)) {
    const iso = ISO_MM[String(kader?.formaat || '').toLowerCase()];
    if (!iso) return null;
    [b, h] = iso;
    if (RICHTING[String(kader.orientatie || '').toLowerCase()] === 'landscape') [b, h] = [h, b];
  }
  return { breedteMm: b, hoogteMm: h };
}

/** Een afbeelding (SVG of PNG als bytes) als PNG-bytes, met hoogstens `maxPx` pixels aan de lange kant. */
async function alsPng(bytes, soort, breedtePx, hoogtePx) {
  if (soort === 'png') return new Uint8Array(bytes);
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/svg+xml' }));
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('SVG niet te lezen'));
      el.src = url;
    });
    const verhouding = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : breedtePx / hoogtePx;
    let w = Math.round(breedtePx);
    let h = Math.round(hoogtePx || w / verhouding);
    const schaal = Math.min(1, MAX_PIXELS / Math.max(w, h));
    w = Math.max(1, Math.round(w * schaal));
    h = Math.max(1, Math.round(h * schaal));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Eén vel volgens het kader: { bytes, widthPt, heightPt }. */
export async function maakKaderPdf(kader) {
  const { breedteMm, hoogteMm } = kaderMaat(kader);
  const widthPt = breedteMm * PT_PER_MM;
  const heightPt = hoogteMm * PT_PER_MM;
  const pdf = await PDFDocument.create();
  const pagina = pdf.addPage([widthPt, heightPt]);

  const sjabloon = kader.template;
  if (sjabloon?.bytes && sjabloon.soort === 'svg') {
    try {
      const px = (mm) => (mm / 25.4) * SJABLOON_DPI;
      const png = await pdf.embedPng(await alsPng(sjabloon.bytes, 'svg', px(breedteMm), px(hoogteMm)));
      pagina.drawImage(png, { x: 0, y: 0, width: widthPt, height: heightPt });
    } catch (e) {
      console.warn('[huisstijl] sjabloon niet geplaatst:', e?.message ?? e);
    }
  }

  const logo = kader.logo;
  if (logo?.bytes && (logo.soort === 'svg' || logo.soort === 'png')) {
    try {
      const breedte = (Number(logo.breedte_mm) || 40) * PT_PER_MM;
      const png = await pdf.embedPng(await alsPng(logo.bytes, logo.soort, (breedte / 72) * SJABLOON_DPI * 2, 0));
      const hoogte = breedte * (png.height / png.width);
      pagina.drawImage(png, {
        x: (Number(logo.x_mm) || 0) * PT_PER_MM,
        y: (Number(logo.y_mm) || 0) * PT_PER_MM,
        width: breedte,
        height: hoogte,
      });
    } catch (e) {
      console.warn('[huisstijl] logo niet geplaatst:', e?.message ?? e);
    }
  }

  const velden = Array.isArray(kader.velden) ? kader.velden : [];
  if (velden.length) {
    const form = pdf.getForm();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const namen = new Set();
    for (const v of velden) {
      const basis = String(v.veld || v.label || 'veld').replace(/[^\w-]/g, '_') || 'veld';
      let naam = basis;
      for (let n = 2; namen.has(naam); n++) naam = `${basis}_${n}`;
      namen.add(naam);
      const grootte = Number(v.lettergrootte) || 9;
      const breedte = VELD_BREEDTE_MM * PT_PER_MM;
      const hoogte = grootte * 1.6;
      let x = (Number(v.x_mm) || 0) * PT_PER_MM;
      if (v.uitlijning === 'midden' || v.uitlijning === 'center') x -= breedte / 2;
      else if (v.uitlijning === 'rechts' || v.uitlijning === 'right') x -= breedte;
      const veld = form.createTextField(naam);
      veld.addToPage(pagina, {
        x,
        y: (Number(v.y_mm) || 0) * PT_PER_MM - grootte * 0.3,
        width: breedte,
        height: hoogte,
        font,
        borderWidth: 0,
      });
      veld.setFontSize(grootte);
      if (v.uitlijning === 'midden' || v.uitlijning === 'center') veld.setAlignment(1);
      else if (v.uitlijning === 'rechts' || v.uitlijning === 'right') veld.setAlignment(2);
      // Het label als tooltip (TU), zodat je ziet welk veld je invult.
      if (v.label) veld.acroField.dict.set(PDFName.of('TU'), PDFHexString.fromText(String(v.label)));
    }
    form.updateFieldAppearances(font);
  }

  return { bytes: await pdf.save(), widthPt, heightPt };
}
