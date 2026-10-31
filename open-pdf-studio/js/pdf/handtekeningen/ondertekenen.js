// "Digitaal ondertekenen" (#374, spec §3.1): het opgeslagen bestand
// ondertekenen met een certificaat uit een .p12/.pfx. De cryptografie en de
// incrementele toevoeging doet Rust (pdf_sign, crate open-pdf-signatures); hier
// staan de stappen eromheen: eerst opslaan, vak kiezen, weergave tekenen,
// doelbestand kiezen, ondertekenen en het resultaat openen.
//
// Ondertekenen werkt op het bestand zoals het op schijf staat. Daarmee zitten
// alle eerder toegevoegde annotaties in het ondertekende bestand, en de bron
// verandert niet. Later gewoon opslaan herschrijft het bestand en maakt de
// handtekening ongeldig; daarvoor waarschuwt verificatie.js al.

import { getActiveDocument, state } from '../../core/state.js';
import { invoke, isTauri, openFileDialog, saveFileDialog } from '../../core/platform.js';
import { leesOpslagJson, schrijfOpslagJson } from '../../core/opslag.js';
import i18next from '../../i18n/config.js';
import { standaardDoelPad, doelIsGeopend } from '../print-doel.js';
import { bronVoorBeveiliging } from '../protect-pdf-regels.js';
import { opslaanGeweigerd } from '../wachtwoord-pdf.js';
import {
  pdfDatum, foutMelding, isTijdstempelFout, weergaveRegels, vakNaarPdf, weergaveMaat, normaliseerKeuzes,
} from './ondertekenen-regels.js';

const OPSLAG = 'digitalSignOptions';
/** Opgeslagen handtekeningafbeeldingen van de knop Handtekening (SignatureDialog.jsx). */
const AFBEELDINGEN = 'pdfEditorSignatures';
export const ONDERTEKEND_ACHTERVOEGSEL = ' (signed)';

const t = (sleutel, opties) => i18next.t(`dialogs:digitalSign.${sleutel}`, opties);

async function melding(tekst) {
  const { showMessage } = await import('../../solid/stores/dialogStore.js');
  showMessage(tekst);
}

export function leesKeuzes() {
  return normaliseerKeuzes(leesOpslagJson(OPSLAG, null));
}

export function bewaarKeuzes(keuzes) {
  schrijfOpslagJson(OPSLAG, normaliseerKeuzes(keuzes));
}

/** De opgeslagen handtekeningafbeeldingen (data-URL's), voor de keuzelijst. */
export function opgeslagenAfbeeldingen() {
  const lijst = leesOpslagJson(AFBEELDINGEN, []);
  return Array.isArray(lijst) ? lijst.filter((s) => typeof s?.dataUrl === 'string') : [];
}

/**
 * Knop "Digitaal ondertekenen": controleert het document, laat het zo nodig
 * eerst opslaan en opent de dialoog.
 */
export async function startDigitaalOndertekenen() {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc) return;
  if (!isTauri()) {
    await melding(t('desktopOnly'));
    return;
  }
  if (opslaanGeweigerd(doc)) {
    await melding(t('errors.encrypted'));
    return;
  }
  if (doc.modified || doc.isUntitled || !doc.filePath) {
    const { showConfirm } = await import('../../ui/chrome/confirm-dialog.js');
    if (!(await showConfirm({ title: t('title'), message: t('saveFirst') }))) return;
    const { savePDF } = await import('../saver.js');
    if (!(await savePDF())) return;
  }
  if (!bronVoorBeveiliging(doc) || doc.modified) {
    await melding(t('notSaved'));
    return;
  }
  const { openDialog } = await import('../../solid/stores/dialogStore.js');
  openDialog('digital-sign', { docId: doc.id ?? null });
}

/** Bestand kiezen; null bij afbreken. */
export async function kiesCertificaatbestand() {
  const r = await openFileDialog(['p12', 'pfx']);
  return Array.isArray(r) ? (r[0] || null) : (r || null);
}

/** Gegevens van het certificaat (pdf_certificate_info); gooit de foutcode van Rust. */
export function leesCertificaat(pad, wachtwoord) {
  return invoke('pdf_certificate_info', { pad, wachtwoord });
}

function laadAfbeelding(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('afbeelding'));
    img.src = url;
  });
}

/**
 * De zichtbare weergave als PNG (base64, zonder data-URL-kop): links de
 * handtekeningafbeelding (als gekozen), rechts de tekstregels, in de
 * leesrichting van de pagina. In de browser getekend, zodat elk schrift en
 * elke taal van de labels gewoon werkt.
 */
export async function tekenWeergave({ breedtePt, hoogtePt, regels, afbeeldingUrl = null, rtl = false }) {
  const { breedte, hoogte, schaal } = weergaveMaat(breedtePt, hoogtePt);
  const canvas = document.createElement('canvas');
  canvas.width = breedte;
  canvas.height = hoogte;
  const ctx = canvas.getContext('2d');
  const marge = 2 * schaal;
  let tekstLinks = marge;
  let tekstRechts = breedte - marge;
  if (afbeeldingUrl) {
    const img = await laadAfbeelding(afbeeldingUrl);
    const vakB = regels.length ? breedte * 0.42 : breedte;
    const beschikbaarB = vakB - 2 * marge;
    const beschikbaarH = hoogte - 2 * marge;
    const f = Math.min(beschikbaarB / img.naturalWidth, beschikbaarH / img.naturalHeight);
    const b = img.naturalWidth * f;
    const h = img.naturalHeight * f;
    const x = rtl ? breedte - vakB + marge + (beschikbaarB - b) / 2 : marge + (beschikbaarB - b) / 2;
    ctx.drawImage(img, x, marge + (beschikbaarH - h) / 2, b, h);
    if (rtl) tekstRechts = breedte - vakB;
    else tekstLinks = vakB;
  }
  if (regels.length) {
    const beschikbaarB = Math.max(1, tekstRechts - tekstLinks);
    const beschikbaarH = Math.max(1, hoogte - 2 * marge);
    const familie = '"Segoe UI", Arial, "Noto Sans", sans-serif';
    let grootte = Math.min(beschikbaarH / (regels.length * 1.25), 12 * schaal);
    ctx.font = `${grootte}px ${familie}`;
    const breedst = Math.max(...regels.map((r) => ctx.measureText(r).width), 1);
    if (breedst > beschikbaarB) grootte *= beschikbaarB / breedst;
    ctx.font = `${grootte}px ${familie}`;
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'top';
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = rtl ? 'right' : 'left';
    const totaal = regels.length * grootte * 1.25;
    const boven = marge + Math.max(0, (beschikbaarH - totaal) / 2);
    regels.forEach((regel, i) => ctx.fillText(regel, rtl ? tekstRechts : tekstLinks, boven + i * grootte * 1.25));
  }
  return canvas.toDataURL('image/png').split(',')[1] || '';
}

async function vraag(bericht) {
  if (window.__TAURI__?.dialog?.ask) {
    return window.__TAURI__.dialog.ask(bericht, {
      title: t('title'),
      kind: 'warning',
      okLabel: t('continueWithout'),
      cancelLabel: i18next.t('common:cancel'),
    });
  }
  return window.confirm(bericht);
}

/**
 * Voert de ondertekening uit met de keuzes uit de dialoog.
 * @param {{ doc: object, keuzes: object, wachtwoord: string, certificaat: {naam:string} }} invoer
 * @returns {Promise<{ok:true, pad:string}|{ok:false, reden:'afgebroken'|'vak-afgebroken'|'fout', tekst?:string}>}
 */
export async function voerOndertekeningUit({ doc, keuzes, wachtwoord, certificaat }) {
  const bron = bronVoorBeveiliging(doc);
  if (!bron || doc.modified) return { ok: false, reden: 'fout', tekst: t('notSaved') };
  const nu = new Date();
  let zichtbaar = null;
  if (keuzes.zichtbaar) {
    const { kiesLabelGebied } = await import('../../tools/tools/label-gebied-tool.js');
    const keuze = await kiesLabelGebied(t('pickHint'));
    if (!keuze) return { ok: false, reden: 'vak-afgebroken' };
    if (getActiveDocument() !== doc) return { ok: false, reden: 'afgebroken' };
    const page = await doc.pdfDoc.getPage(keuze.page);
    const extra = (((doc.pageRotations?.[keuze.page] || 0) % 360) + 360) % 360;
    const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + extra) % 360 });
    const rechthoek = vakNaarPdf(keuze.rect, (x, y) => viewport.convertToPdfPoint(x, y));
    let datum;
    try {
      datum = new Intl.DateTimeFormat(i18next.language || undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(nu);
    } catch {
      datum = nu.toLocaleString();
    }
    const regels = weergaveRegels({ naam: certificaat?.naam, datum, reden: keuzes.reden, plaats: keuzes.plaats }, t);
    const afbeeldingen = opgeslagenAfbeeldingen();
    const afbeeldingUrl = keuzes.afbeelding >= 0 ? afbeeldingen[keuzes.afbeelding]?.dataUrl || null : null;
    let weergaveBase64;
    try {
      weergaveBase64 = await tekenWeergave({
        breedtePt: keuze.rect.width,
        hoogtePt: keuze.rect.height,
        regels,
        afbeeldingUrl,
        rtl: i18next.dir?.() === 'rtl',
      });
    } catch (e) {
      return { ok: false, reden: 'fout', tekst: t('errors.imageUnreadable', { detail: e?.message || String(e) }) };
    }
    zichtbaar = { pagina: keuze.page, rechthoek, weergaveBase64 };
  }

  const doel = await saveFileDialog(standaardDoelPad(doc, null, ONDERTEKEND_ACHTERVOEGSEL), [
    { name: 'PDF', extensions: ['pdf'] },
  ]);
  if (!doel) return { ok: false, reden: 'afgebroken' };
  if (doelIsGeopend(doel, state.documents)) {
    return { ok: false, reden: 'fout', tekst: i18next.t('dialogs:print.targetIsOpenFile') };
  }

  const opties = {
    subfilter: keuzes.subfilter,
    zichtbaar,
    reden: keuzes.reden || null,
    plaats: keuzes.plaats || null,
    contact: keuzes.contact || null,
    tijdstip: pdfDatum(nu),
  };
  const args = { bron, doel, p12: keuzes.p12, wachtwoord, opties, tijdstempelUrl: keuzes.tijdstempelUrl || null };
  try {
    await invoke('pdf_sign', args);
  } catch (e) {
    if (!isTijdstempelFout(e) || !args.tijdstempelUrl) {
      const { sleutel, opties: o } = foutMelding(e);
      console.warn('[handtekening] ondertekenen mislukt:', e);
      return { ok: false, reden: 'fout', tekst: i18next.t(`dialogs:${sleutel}`, o) };
    }
    // Nooit stil zonder tijdstempel (spec §6.4): eerst vragen.
    if (!(await vraag(t('timestampFailed', { detail: foutMelding(e).opties.detail })))) return { ok: false, reden: 'afgebroken' };
    try {
      await invoke('pdf_sign', { ...args, tijdstempelUrl: null });
    } catch (e2) {
      const { sleutel, opties: o } = foutMelding(e2);
      return { ok: false, reden: 'fout', tekst: i18next.t(`dialogs:${sleutel}`, o) };
    }
  }
  // Het ondertekende bestand openen, met zijn verificatiestatus (spec §3.1 stap 6).
  try {
    const { createTab } = await import('../../ui/chrome/tabs.js');
    const { loadPDFIfNeeded } = await import('../loader.js');
    const { index } = createTab(doel);
    await loadPDFIfNeeded(doel, index);
  } catch (e) {
    console.warn('[handtekening] ondertekend bestand openen mislukt:', e);
  }
  return { ok: true, pad: doel };
}
