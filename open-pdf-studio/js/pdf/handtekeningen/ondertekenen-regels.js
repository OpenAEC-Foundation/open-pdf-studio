// Kleine, pure regels voor "Digitaal ondertekenen" (#374): PDF-datum, de
// foutmeldingen van pdf_sign en pdf_certificate_info, de tekstregels van een
// zichtbare handtekening, het vak omrekenen naar PDF-punten en de onthouden
// keuzes. Geen DOM, i18n of Tauri, zodat node:test het kan toetsen.

/** Sleutels binnen de namespace `dialogs`. */
const D = 'digitalSign';

/**
 * `/M` van het handtekeningwoordenboek: lokale tijd met tijdzone, zoals
 * `D:20261027213000+01'00'` (ISO 32000-1 §7.9.4).
 * @param {Date} datum
 */
export function pdfDatum(datum = new Date()) {
  const twee = (n) => String(Math.trunc(Math.abs(n))).padStart(2, '0');
  const verschil = -datum.getTimezoneOffset();
  const teken = verschil >= 0 ? '+' : '-';
  return `D:${datum.getFullYear()}${twee(datum.getMonth() + 1)}${twee(datum.getDate())}`
    + `${twee(datum.getHours())}${twee(datum.getMinutes())}${twee(datum.getSeconds())}`
    + `${teken}${twee(verschil / 60)}'${twee(verschil % 60)}'`;
}

// Foutcodes van pdf_sign (open-pdf-signatures/src/onderteken.rs, OndertekenFout)
// en pdf_certificate_info (certificaat.rs, InfoFout) → vertaalsleutel.
const FOUTEN = {
  'verkeerd-wachtwoord': 'errors.wrongPassword',
  'geen-prive-sleutel': 'errors.noPrivateKey',
  'geen-certificaat': 'errors.noCertificate',
  'sleutel-niet-ondersteund': 'errors.unsupportedKey',
  'algoritme-niet-ondersteund': 'errors.unsupportedAlgorithm',
  'sleutelgebruik-ongeschikt': 'errors.keyUsage',
  'versleuteld': 'errors.encrypted',
  'zelfde-bestand': 'errors.sameFile',
  'pagina-bestaat-niet': 'errors.pageMissing',
  'afbeelding-onleesbaar': 'errors.imageUnreadable',
  'pdf-onleesbaar': 'errors.pdfUnreadable',
  'tijdstempel': 'errors.timestamp',
  'onleesbaar': 'errors.unreadable',
  'schrijven': 'errors.write',
  'intern': 'errors.internal',
};

/**
 * De melding bij een fout van pdf_sign of pdf_certificate_info.
 * @returns {{ sleutel: string, opties: { detail: string } }}
 */
export function foutMelding(fout) {
  const code = fout && typeof fout === 'object' ? fout.code : null;
  const detail = String((fout && typeof fout === 'object' ? (fout.detail ?? fout.message) : fout) ?? '').trim();
  const sleutel = (code && Object.prototype.hasOwnProperty.call(FOUTEN, code)) ? FOUTEN[code] : 'errors.internal';
  return { sleutel: `${D}.${sleutel}`, opties: { detail: detail || String(code || '') } };
}

/** Mislukte de ondertekening alleen op het tijdstempel? Dan mag het zonder (na een vraag). */
export function isTijdstempelFout(fout) {
  return !!fout && typeof fout === 'object' && fout.code === 'tijdstempel';
}

/**
 * Tekstregels van een zichtbare handtekening. `v(sleutel, opties)` vertaalt
 * binnen `digitalSign`; lege reden of plaats valt weg.
 */
export function weergaveRegels({ naam, datum, reden, plaats }, v) {
  const regels = [v('signedBy', { name: naam || '' })];
  if (datum) regels.push(v('dateLine', { date: datum }));
  if (reden && reden.trim()) regels.push(v('reasonLine', { reason: reden.trim() }));
  if (plaats && plaats.trim()) regels.push(v('locationLine', { location: plaats.trim() }));
  return regels;
}

/**
 * Een vak in app-ruimte ({x, y, width, height}, y omlaag) naar
 * `[x1, y1, x2, y2]` in PDF-punten, met `naarPdf(x, y) → [px, py]` (pdf.js
 * `viewport.convertToPdfPoint`). De hoeken worden gesorteerd: bij een
 * gedraaide pagina wisselen ze van plaats.
 */
export function vakNaarPdf(vak, naarPdf) {
  const a = naarPdf(vak.x, vak.y);
  const b = naarPdf(vak.x + vak.width, vak.y + vak.height);
  const r = (n) => Math.round(n * 100) / 100;
  return [r(Math.min(a[0], b[0])), r(Math.min(a[1], b[1])), r(Math.max(a[0], b[0])), r(Math.max(a[1], b[1]))];
}

/**
 * Pixelmaat van de weergave: ongeveer 4 pixels per punt, de lange zijde
 * hooguit 2400 pixels, minstens 1.
 */
export function weergaveMaat(breedtePt, hoogtePt) {
  const schaal = Math.min(4, 2400 / Math.max(breedtePt, hoogtePt, 1));
  return {
    breedte: Math.max(1, Math.round(breedtePt * schaal)),
    hoogte: Math.max(1, Math.round(hoogtePt * schaal)),
    schaal,
  };
}

/** Onthouden keuzes (nooit het wachtwoord). */
export const STANDAARD_KEUZES = Object.freeze({
  p12: '',
  zichtbaar: true,
  afbeelding: -1,
  reden: '',
  plaats: '',
  contact: '',
  subfilter: 'ETSI.CAdES.detached',
  tijdstempelUrl: '',
});

/** Opgeslagen keuzes, opgeschoond: onbekende of verkeerde velden vallen terug op de standaard. */
export function normaliseerKeuzes(ruw) {
  const k = { ...STANDAARD_KEUZES };
  if (!ruw || typeof ruw !== 'object') return k;
  for (const veld of ['p12', 'reden', 'plaats', 'contact', 'tijdstempelUrl']) {
    if (typeof ruw[veld] === 'string') k[veld] = ruw[veld].slice(0, 2000);
  }
  if (typeof ruw.zichtbaar === 'boolean') k.zichtbaar = ruw.zichtbaar;
  if (Number.isInteger(ruw.afbeelding) && ruw.afbeelding >= -1 && ruw.afbeelding < 100) k.afbeelding = ruw.afbeelding;
  if (ruw.subfilter === 'adbe.pkcs7.detached' || ruw.subfilter === 'ETSI.CAdES.detached') k.subfilter = ruw.subfilter;
  return k;
}

/** Is `url` een bruikbaar adres voor een tijdstempeldienst (leeg = geen tijdstempel)? */
export function geldigeTijdstempelUrl(url) {
  const tekst = String(url || '').trim();
  if (!tekst) return true;
  try {
    const u = new URL(tekst);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
