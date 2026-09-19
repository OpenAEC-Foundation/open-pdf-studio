// Weergave van handtekeningstatussen uit pdf_signature_list: i18n-sleutels,
// ernst en kleine beslissingen. Puur: geen i18n, DOM of Tauri, zodat het met
// node:test te toetsen is. Sleutels zijn relatief aan de namespace `dialogs`.

const V = 'signatureVerification';

const STATUS_SLEUTEL = {
  'geldig': `${V}.status.valid`,
  'onbekend-certificaat': `${V}.status.unknownCertificate`,
  'gewijzigd-na-ondertekenen': `${V}.status.modified`,
  'ongeldige-handtekening': `${V}.status.invalid`,
  'niet-te-controleren': `${V}.status.notVerifiable`,
  'niet-ondertekend-veld': `${V}.status.unsignedField`,
};

const REDEN_SLEUTEL = {
  'geen-keten': `${V}.reasons.noChain`,
  'verlopen': `${V}.reasons.expired`,
  'sleutelgebruik': `${V}.reasons.keyUsage`,
  'algoritme-niet-ondersteund': `${V}.reasons.unsupportedAlgorithm`,
  'cms-onleesbaar': `${V}.reasons.cmsUnreadable`,
  'geen-certificaat': `${V}.reasons.noCertificate`,
  'bytebereik-ongeldig': `${V}.reasons.byteRangeInvalid`,
  'pdf-onleesbaar': `${V}.reasons.pdfUnreadable`,
  'verouderd-formaat': `${V}.reasons.legacyFormat`,
};

/**
 * Vaste signalen uit Rust (`status::signaal`). Elke code heeft een eigen tekst
 * onder `signals.<code>`; i18n-sleutels.test.mjs houdt deze lijst gelijk aan
 * Rust. Een onbekende code (nieuwer Rust dan JS) krijgt `signals.unknown`.
 */
export const SIGNALEN = [
  'digestalgoritme-niet-ondersteund',
  'handtekeningalgoritme-niet-ondersteund',
  'imprintalgoritme-niet-ondersteund',
  'contenttype-ontbreekt-of-meervoudig',
  'contenttype-wijkt-af',
  'messagedigest-ontbreekt-of-meervoudig',
  'certificaat-ondertekenaar-ontbreekt',
  'zonder-attributen-niet-te-onderscheiden',
  'cms-structuur-onleesbaar',
  'econtent-bij-losse-handtekening',
  'econtenttype-geen-id-data',
  'geen-ondertekenaar',
  'token-zonder-tstinfo',
  'tstinfo-onleesbaar',
  'bytebereik-geen-vier-getallen',
  'bytebereik-negatief',
  'bytebereik-begint-niet-bij-nul',
  'bytebereik-gat-te-klein',
  'bytebereik-voorbij-einde',
  'bytebereik-gat-geen-hex-string',
  'subfilter-niet-ondersteund',
  'zoekbudget-op',
  'gat-wijkt-af-van-contents',
  'interne-fout',
];

const BEKENDE_SIGNALEN = new Set(SIGNALEN);

/** Fouten van pdf_signature_list en pdf_signed_revision met een eigen tekst. */
const FOUT_SLEUTEL = {
  'pdf-onleesbaar': `${V}.reasons.pdfUnreadable`,
  'onleesbaar': `${V}.errors.unreadable`,
  'geen-handtekening': `${V}.errors.noSignature`,
  'gewijzigd-sinds-lijst': `${V}.errors.changedSinceList`,
};

const RANG = { neutraal: 0, goed: 1, waarschuwing: 2, fout: 3 };

/** i18n-sleutel voor de status van één handtekening. */
export function statusSleutel(info) {
  return STATUS_SLEUTEL[info?.status?.code] || `${V}.status.notVerifiable`;
}

/** i18n-sleutel voor de uitleg bij de status; null als er niets uit te leggen is. */
export function redenSleutel(info) {
  const code = info?.status?.code;
  const reden = info?.status?.reden;
  if (reden && REDEN_SLEUTEL[reden]) return REDEN_SLEUTEL[reden];
  if (code === 'geldig') return `${V}.explanation.valid`;
  if (code === 'gewijzigd-na-ondertekenen') return `${V}.explanation.modified`;
  if (code === 'ongeldige-handtekening') return `${V}.explanation.invalid`;
  return null;
}

/** i18n-sleutel voor een pdf-onleesbaar-fout van de hele lijst. */
export function lijstFoutRedenSleutel(fout) {
  return fout?.code === 'pdf-onleesbaar' ? REDEN_SLEUTEL['pdf-onleesbaar'] : null;
}

/** i18n-sleutel voor een fout met bekende code; null bij een onbekende fout. */
export function foutSleutel(fout) {
  return (fout && Object.prototype.hasOwnProperty.call(FOUT_SLEUTEL, fout.code)) ? FOUT_SLEUTEL[fout.code] : null;
}

/** i18n-sleutel voor één signaalcode; een onbekende code krijgt een neutrale tekst. */
export function signaalSleutel(code) {
  return BEKENDE_SIGNALEN.has(code) ? `${V}.signals.${code}` : `${V}.signals.unknown`;
}

function sleutelsVan(signalen) {
  if (!Array.isArray(signalen)) return [];
  return [...new Set(signalen.filter((s) => typeof s === 'string' && s).map(signaalSleutel))];
}

/** i18n-sleutels voor de signalen van een handtekening, zonder dubbelen. */
export function signaalSleutels(info) {
  return sleutelsVan(info?.signalen);
}

/** i18n-sleutels voor de signalen van het handtekeningtijdstempel. */
export function tijdstempelSignaalSleutels(info) {
  return sleutelsVan(info?.tijdstempel?.signalen);
}

/**
 * Regels voor "Technisch detail": de ruwe `detail` uit Rust (Nederlands,
 * onvertaald) en de SubFilter. Leeg als er niets is.
 */
export function technischDetail(info) {
  const regels = [];
  if (info?.detail) regels.push(String(info.detail));
  if (info?.subfilter) regels.push(`SubFilter: ${info.subfilter}`);
  return regels;
}

/**
 * Is het document in de app gewijzigd ten opzichte van het bestand op schijf?
 * De handtekeningstatus geldt voor het bestand op schijf. Een werkkopie telt
 * niet apart: vóór opslaan is het document dan al gewijzigd, en na opslaan
 * staan dezelfde bytes op schijf.
 */
export function wijktAfVanSchijf(doc) {
  return !!doc?.modified;
}

/** Status-sleutel voor een handtekeningtijdstempel ({ integriteit, vertrouwen }). */
export function tijdstempelStatusSleutel(tijdstempel) {
  const uitkomst = tijdstempel?.integriteit?.uitkomst;
  if (uitkomst === 'intact') {
    return tijdstempel?.vertrouwen?.uitkomst === 'vertrouwd'
      ? `${V}.status.valid`
      : `${V}.status.unknownCertificate`;
  }
  if (uitkomst === 'gewijzigd') return `${V}.status.modified`;
  if (uitkomst === 'ongeldig') return `${V}.status.invalid`;
  return `${V}.status.notVerifiable`;
}

/** 'goed' | 'waarschuwing' | 'fout' | 'neutraal' — voor kleur en icoon. */
export function ernst(info) {
  switch (info?.status?.code) {
    case 'geldig': return info.daarnaGewijzigd ? 'waarschuwing' : 'goed';
    case 'onbekend-certificaat': return 'waarschuwing';
    case 'niet-te-controleren': return 'waarschuwing';
    case 'gewijzigd-na-ondertekenen': return 'fout';
    case 'ongeldige-handtekening': return 'fout';
    case 'niet-ondertekend-veld': return 'neutraal';
    default: return 'waarschuwing';
  }
}

/** Ernstigste uitkomst van een lijst (voor de kleur van de balk). */
export function ernstigste(lijst) {
  let uit = 'neutraal';
  for (const info of lijst || []) {
    const e = ernst(info);
    if (RANG[e] > RANG[uit]) uit = e;
  }
  return uit;
}

/** Minstens één intacte handtekening? Dan waarschuwen bij gewoon opslaan. */
export function heeftIntacteHandtekening(lijst) {
  return Array.isArray(lijst) && lijst.some((h) => h?.integriteit?.uitkomst === 'intact');
}

/** "Toon ondertekende versie" alleen bij "daarna nog gewijzigd" (spec §7.2). */
export function kanOndertekendeVersieTonen(info) {
  return info?.daarnaGewijzigd === true && Number.isInteger(info?.nummer);
}

/**
 * Heeft het document meer handtekeningvelden dan de controle leest? Rust zet
 * `lijstAfgekapt` gelijk op elke regel; dan zijn niet alle velden gecontroleerd.
 */
export function lijstIsAfgekapt(lijst) {
  return Array.isArray(lijst) && lijst.some((h) => h?.lijstAfgekapt === true);
}

/** Kleur van de balk; een afgekapte lijst is minstens een waarschuwing. */
export function balkErnst(toestand, lijst) {
  if (toestand === 'fout') return 'waarschuwing';
  const uit = ernstigste(lijst);
  return lijstIsAfgekapt(lijst) && RANG[uit] < RANG.waarschuwing ? 'waarschuwing' : uit;
}

/**
 * Argumenten voor pdf_signed_revision. `bereikEinde` uit de lijst laat de
 * Rust-kant controleren dat de handtekening daar nog eindigt, zodat een sinds
 * de controle gewijzigd bestand niet stil een andere versie oplevert.
 */
export function ondertekendeVersieArgumenten(pad, info) {
  const args = { pad, nummer: info?.nummer };
  if (Number.isSafeInteger(info?.bereikEinde) && info.bereikEinde >= 0) args.bereikEinde = info.bereikEinde;
  return args;
}

/** Fout van pdf_signed_revision: het bestand is sinds de controle gewijzigd. */
export function isGewijzigdSindsLijst(fout) {
  return fout?.code === 'gewijzigd-sinds-lijst';
}

/**
 * Naam bij een documenttijdstempel, gelijk in balk en detailvenster: met
 * dienst `documentTimestampBy`, anders `documentTimestamp`. `v(sleutel, opties)`
 * vertaalt binnen `signatureVerification`.
 */
export function documenttijdstempelNaam(h, v) {
  return h?.ondertekenaar ? v('documentTimestampBy', { tsa: h.ondertekenaar }) : v('documentTimestamp');
}

/**
 * Tekst van een regel in de balk, in twee delen: `status` (status en eventueel
 * "daarna nog gewijzigd"; wordt in een smalle balk niet ingekort) en `rest`
 * (naam en tijdstip; kort als eerste in). `v` vertaalt binnen
 * `signatureVerification`, `t` volledige sleutels; `nietOndertekend(h, tekst)`
 * markeert gegevens buiten het eigen bytebereik.
 */
export function balkRegelDelen(h, { v, t, taal, nietOndertekend = (_h, tekst) => tekst }) {
  const basis = t(statusSleutel(h));
  const status = h?.daarnaGewijzigd ? v('format.joined', { first: basis, second: v('changedAfterwards') }) : basis;
  let naam;
  if (h?.soort === 'leeg-veld') naam = h.veldnaam || '';
  else if (h?.soort === 'documenttijdstempel') naam = documenttijdstempelNaam(h, v);
  else if (h?.ondertekenaar) naam = h.ondertekenaar;
  else if (h?.opgegevenNaam) naam = nietOndertekend(h, h.opgegevenNaam);
  else naam = v('unknownSigner');
  let tijd = formatTijd(h?.tijdUnix, taal);
  if (tijd && h?.tijdBron === 'opgegeven') tijd = nietOndertekend(h, tijd);
  const rest = naam && tijd ? v('format.withTime', { text: naam, time: tijd }) : (naam || tijd || '');
  const tekst = rest ? v('format.joined', { first: status, second: rest }) : status;
  return { status, rest, scheiding: rest ? scheidingstekens(v) : '', tekst };
}

/** Het scheidingsteken tussen twee delen volgens `format.joined` van de taal. */
export function scheidingstekens(v) {
  const a = '\u0001';
  const b = '\u0002';
  const patroon = String(v('format.joined', { first: a, second: b }));
  const i = patroon.indexOf(a);
  const j = patroon.indexOf(b);
  return i !== -1 && j > i ? patroon.slice(i + 1, j) : ' — ';
}

/** Tijdstip uit Unix-seconden, of null. */
export function formatTijd(unix, taal, tijdzone) {
  if (typeof unix !== 'number' || !Number.isFinite(unix)) return null;
  const opties = { dateStyle: 'medium', timeStyle: 'short' };
  if (tijdzone) opties.timeZone = tijdzone;
  try {
    return new Intl.DateTimeFormat(taal || undefined, opties).format(new Date(unix * 1000));
  } catch {
    return new Date(unix * 1000).toISOString();
  }
}

/** Heeft het pdf.js-document handtekeningvelden? Goedkoop: alleen het AcroForm. */
export async function heeftHandtekeningvelden(pdfDoc) {
  if (!pdfDoc || typeof pdfDoc.getFieldObjects !== 'function') return false;
  try {
    const velden = await pdfDoc.getFieldObjects();
    if (!velden) return false;
    return Object.values(velden).some((lijst) => Array.isArray(lijst) && lijst.some((v) => v?.type === 'signature'));
  } catch {
    return false;
  }
}

/**
 * Staan reden, plaats, contact, opgegeven naam en /M buiten het ondertekende
 * bytebereik? Dan zijn ze niet mee ondertekend en toont de UI dat erbij.
 */
export function woordenboekNietOndertekend(info) {
  return !!info && info.soort !== 'leeg-veld' && info.woordenboekOndertekend === false;
}

/** Zwak algoritme (SHA-1) in handtekening, keten of tijdstempel: alleen een waarschuwing. */
export function heeftZwakAlgoritme(info) {
  return info?.zwakAlgoritme === true || info?.tijdstempel?.zwakAlgoritme === true;
}

/** Getal (bv. bytes) in de notatie van de taal; '' als er geen getal is. */
export function formatGetal(getal, taal) {
  if (typeof getal !== 'number' || !Number.isFinite(getal)) return '';
  try {
    return new Intl.NumberFormat(taal || undefined).format(getal);
  } catch {
    return new Intl.NumberFormat().format(getal);
  }
}

/** Voegt de niet-lege delen samen met `verbind(links, rechts)` (een vertaalde opmaak). */
export function voegSamen(delen, verbind) {
  return (delen || []).filter((d) => d !== null && d !== undefined && d !== '')
    .reduce((links, rechts) => (links === null ? rechts : verbind(links, rechts)), null) ?? '';
}
