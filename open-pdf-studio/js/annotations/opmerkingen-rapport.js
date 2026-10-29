// Het PDF-rapport van het opmerkingenoverzicht (#383): elke opmerking met
// haar paginanummer, soort, auteur, datum, status, tekst, reacties en een
// uitsnede van de plek op de pagina.
//
// Puur op pdf-lib: geen DOM, geen app-state. De uitsneden komen als PNG- of
// JPEG-bytes binnen (de app rendert ze met renderPageOffscreen, zie
// ui/panels/annotations-summary.js); vertalingen komen als labels binnen.

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const A4 = Object.freeze({ breedte: 595.28, hoogte: 841.89 });
const MARGE = 40;
const UITSNEDE_B = 170;
const UITSNEDE_H = 130;
const TUSSENRUIMTE = 12;
const VOET = 24;

const ZWART = rgb(0.1, 0.1, 0.1);
const GRIJS = rgb(0.4, 0.4, 0.4);
const LIJN = rgb(0.8, 0.8, 0.8);
const KADER = rgb(0.6, 0.6, 0.6);

export const STANDAARD_LABELS = Object.freeze({
  titel: 'Comment Summary',
  document: 'Document',
  gemaakt: 'Created',
  aantal: 'Comments',
  pagina: 'Page',
  auteur: 'Author',
  datum: 'Date',
  status: 'Status',
  onderwerp: 'Subject',
  reacties: 'Replies',
  geenTekst: '(no comment text)',
});

/**
 * Tekst die het font kan tonen: tabs worden spaties, tekens zonder glyph
 * een vraagteken. Regeleinden blijven staan (wrapTekst splitst erop).
 */
export function veiligeTekst(tekst, tekenset) {
  let uit = '';
  for (const teken of String(tekst ?? '').replace(/\r\n?/g, '\n').replace(/\t/g, ' ')) {
    if (teken === '\n') { uit += teken; continue; }
    const cp = teken.codePointAt(0);
    uit += !tekenset || tekenset.has(cp) ? teken : '?';
  }
  return uit;
}

/**
 * Breekt tekst af op een breedte: eerst op regeleinden, dan op woorden; een
 * woord dat alleen al te breed is gaat per teken.
 * @param {string} tekst
 * @param {(s: string) => number} breedteVan
 * @param {number} max
 * @returns {string[]}
 */
export function wrapTekst(tekst, breedteVan, max) {
  const regels = [];
  for (const alinea of String(tekst ?? '').split('\n')) {
    const woorden = alinea.split(/ +/).filter((w) => w !== '');
    if (woorden.length === 0) { regels.push(''); continue; }
    let regel = '';
    for (let woord of woorden) {
      const kandidaat = regel ? `${regel} ${woord}` : woord;
      if (breedteVan(kandidaat) <= max) { regel = kandidaat; continue; }
      if (regel) regels.push(regel);
      regel = '';
      while (breedteVan(woord) > max && woord.length > 1) {
        let n = 1;
        const tekens = [...woord];
        while (n < tekens.length && breedteVan(tekens.slice(0, n + 1).join('')) <= max) n++;
        regels.push(tekens.slice(0, n).join(''));
        woord = tekens.slice(n).join('');
      }
      regel = woord;
    }
    regels.push(regel);
  }
  return regels;
}

/** Past een plaatje binnen een vak, zonder te vergroten. */
export function pasIn(breedte, hoogte, maxB, maxH) {
  if (!(breedte > 0) || !(hoogte > 0)) return { breedte: 0, hoogte: 0 };
  const f = Math.min(1, maxB / breedte, maxH / hoogte);
  return { breedte: breedte * f, hoogte: hoogte * f };
}

async function standaardFonts(pdf) {
  return {
    normaal: await pdf.embedFont(StandardFonts.Helvetica),
    vet: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
}

async function plaatjeVan(pdf, uitsnede) {
  if (!uitsnede || !uitsnede.bytes) return null;
  try {
    return uitsnede.soort === 'jpeg' ? await pdf.embedJpg(uitsnede.bytes) : await pdf.embedPng(uitsnede.bytes);
  } catch {
    return null;
  }
}

/**
 * Bouwt het rapport.
 * @param {{
 *   documentNaam?: string,
 *   gemaakt?: string,
 *   labels?: Partial<typeof STANDAARD_LABELS>,
 *   voettekst?: (n: number, totaal: number) => string,
 *   ingangen: Array<{
 *     pagina: number, type?: string, auteur?: string, datum?: string,
 *     status?: string, onderwerp?: string, inhoud?: string,
 *     reacties?: Array<{ auteur?: string, datum?: string, tekst?: string }>,
 *     uitsnede?: { bytes: Uint8Array, soort: 'png'|'jpeg' } | null,
 *   }>,
 *   kiesFonts?: (pdf: PDFDocument) => Promise<{ normaal: any, vet?: any } | null>,
 * }} invoer
 * @returns {Promise<{ bytes: Uint8Array, paginas: number,
 *   ingangen: Array<{ nummer: number, pagina: number, rapportPagina: number, uitsnede: boolean }> }>}
 */
export async function bouwOpmerkingenRapport(invoer) {
  const labels = { ...STANDAARD_LABELS, ...((invoer && invoer.labels) || {}) };
  const ingangen = (invoer && invoer.ingangen) || [];
  const voettekst = (invoer && invoer.voettekst) || ((n, m) => `${n} / ${m}`);

  const pdf = await PDFDocument.create();
  pdf.setTitle(labels.titel);
  pdf.setCreator('Open PDF Studio');
  pdf.setProducer('Open PDF Studio');

  let fonts = null;
  if (invoer && invoer.kiesFonts) {
    try { fonts = await invoer.kiesFonts(pdf); } catch { fonts = null; }
  }
  if (!fonts || !fonts.normaal) fonts = await standaardFonts(pdf);
  const normaal = fonts.normaal;
  const vet = fonts.vet || fonts.normaal;
  const tekenset = (font) => new Set(font.getCharacterSet());
  const sets = new Map([[normaal, tekenset(normaal)]]);
  if (!sets.has(vet)) sets.set(vet, tekenset(vet));
  const veilig = (tekst, font) => veiligeTekst(tekst, sets.get(font));

  const tekstX = MARGE + UITSNEDE_B + TUSSENRUIMTE;
  const tekstB = A4.breedte - MARGE - tekstX;
  const onderGrens = MARGE + VOET;

  let pagina = null;
  let y = 0;
  let paginaLeeg = true;
  const nieuwePagina = (eerste) => {
    pagina = pdf.addPage([A4.breedte, A4.hoogte]);
    paginaLeeg = true;
    y = A4.hoogte - MARGE;
    if (eerste) {
      const titel = veilig(labels.titel, vet);
      pagina.drawText(titel, { x: MARGE, y: y - 16, size: 16, font: vet, color: ZWART });
      y -= 28;
      const regels = [
        invoer.documentNaam ? `${labels.document}: ${invoer.documentNaam}` : null,
        invoer.gemaakt ? `${labels.gemaakt}: ${invoer.gemaakt}` : null,
        `${labels.aantal}: ${ingangen.length}`,
      ].filter(Boolean);
      for (const r of regels) {
        pagina.drawText(veilig(r, normaal), { x: MARGE, y: y - 9, size: 9, font: normaal, color: GRIJS });
        y -= 13;
      }
    } else {
      const kop = [labels.titel, invoer.documentNaam].filter(Boolean).join(' - ');
      pagina.drawText(veilig(kop, normaal), { x: MARGE, y: y - 8, size: 8, font: normaal, color: GRIJS });
      y -= 14;
    }
    pagina.drawLine({ start: { x: MARGE, y }, end: { x: A4.breedte - MARGE, y }, thickness: 0.75, color: LIJN });
    y -= 10;
  };
  nieuwePagina(true);

  const uitslag = [];
  for (let i = 0; i < ingangen.length; i++) {
    const ing = ingangen[i] || {};
    const nummer = i + 1;
    const plaatje = await plaatjeVan(pdf, ing.uitsnede);
    const maat = plaatje ? pasIn(plaatje.width, plaatje.height, UITSNEDE_B, UITSNEDE_H) : null;

    // Alle regels van de tekstkolom: [tekst, font, grootte, kleur, inspring].
    const regels = [];
    const voeg = (tekst, font, grootte, kleur, inspring = 0) => {
      for (const r of wrapTekst(veilig(tekst, font), (s) => font.widthOfTextAtSize(s, grootte), tekstB - inspring)) {
        regels.push({ tekst: r, font, grootte, kleur, inspring });
      }
    };
    voeg(`#${nummer} ${labels.pagina} ${ing.pagina ?? ''}${ing.type ? ` - ${ing.type}` : ''}`, vet, 10, ZWART);
    const meta = [
      ing.auteur ? `${labels.auteur}: ${ing.auteur}` : null,
      ing.datum ? `${labels.datum}: ${ing.datum}` : null,
      ing.status ? `${labels.status}: ${ing.status}` : null,
    ].filter(Boolean).join(' | ');
    if (meta) voeg(meta, normaal, 8.5, GRIJS);
    if (ing.onderwerp) voeg(`${labels.onderwerp}: ${ing.onderwerp}`, normaal, 9, ZWART);
    if (ing.inhoud) voeg(ing.inhoud, normaal, 9, ZWART);
    else voeg(labels.geenTekst, normaal, 9, GRIJS);
    const reacties = (ing.reacties || []).filter(Boolean);
    if (reacties.length > 0) {
      voeg(`${labels.reacties} (${reacties.length})`, vet, 8.5, ZWART);
      for (const r of reacties) {
        const wie = `${r.auteur || 'User'}${r.datum ? ` (${r.datum})` : ''}`;
        voeg(`${wie}: ${r.tekst || ''}`, normaal, 8.5, ZWART, 8);
      }
    }
    const regelHoogte = (r) => r.grootte * 1.3;
    let tekstH = regels.reduce((s, r) => s + regelHoogte(r), 0);
    const blokH = () => Math.max(maat ? maat.hoogte : 0, tekstH) + 12;

    if (y - blokH() < onderGrens && !paginaLeeg) nieuwePagina(false);
    // Past het blok zelfs op een lege pagina niet, dan wordt de tekst ingekort.
    const ruimte = y - onderGrens - 12;
    if (tekstH > ruimte) {
      while (regels.length > 1 && tekstH > ruimte) tekstH -= regelHoogte(regels.pop());
      const laatste = regels[regels.length - 1];
      laatste.tekst = `${laatste.tekst} ...`;
    }

    const boven = y;
    if (plaatje && maat) {
      const px = MARGE + (UITSNEDE_B - maat.breedte) / 2;
      const py = boven - maat.hoogte;
      pagina.drawImage(plaatje, { x: px, y: py, width: maat.breedte, height: maat.hoogte });
      pagina.drawRectangle({ x: px, y: py, width: maat.breedte, height: maat.hoogte, borderColor: KADER, borderWidth: 0.5 });
    }
    let ty = boven;
    for (const r of regels) {
      ty -= regelHoogte(r);
      pagina.drawText(r.tekst, { x: tekstX + r.inspring, y: ty + r.grootte * 0.25, size: r.grootte, font: r.font, color: r.kleur });
    }
    y = boven - blokH();
    pagina.drawLine({ start: { x: MARGE, y: y + 5 }, end: { x: A4.breedte - MARGE, y: y + 5 }, thickness: 0.5, color: LIJN });

    paginaLeeg = false;
    uitslag.push({ nummer, pagina: ing.pagina, rapportPagina: pdf.getPageCount(), uitsnede: !!plaatje });
  }

  const paginas = pdf.getPages();
  paginas.forEach((p, i) => {
    const tekst = veilig(voettekst(i + 1, paginas.length), normaal);
    const b = normaal.widthOfTextAtSize(tekst, 8);
    p.drawText(tekst, { x: A4.breedte - MARGE - b, y: MARGE - 8, size: 8, font: normaal, color: GRIJS });
  });

  const bytes = await pdf.save();
  return { bytes, paginas: paginas.length, ingangen: uitslag };
}
