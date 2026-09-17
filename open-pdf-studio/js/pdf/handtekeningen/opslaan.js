// Beslissingen rond opslaan van een (mogelijk) ondertekend document. Puur:
// geen i18n, DOM of Tauri, zodat het met node:test te toetsen is.
import { heeftIntacteHandtekening } from './weergave.js';

/** Zo lang wacht de opslaanvraag hooguit op een lopende verificatie. */
export const WACHTTIJD_MS = 10000;

/**
 * Maakt gewoon opslaan handtekeningen ongeldig die nu nog iets waard zijn?
 * Bij 'bezig' en 'fout' zijn er handtekeningvelden maar is de uitkomst
 * onbekend: dan voor de zekerheid wel.
 */
export function handtekeningenInGevaar(doc) {
  const toestand = doc?.handtekeningToestand;
  if (toestand === 'bezig' || toestand === 'fout') return true;
  if (toestand === 'klaar') return heeftIntacteHandtekening(doc.handtekeningen);
  return false;
}

/** Wacht op de lopende verificatie van `doc`; 'klaar' of 'time-out'. */
export async function wachtOpVerificatie(doc, wachttijdMs = WACHTTIJD_MS) {
  const belofte = doc?._handtekeningBelofte;
  if (!belofte) return 'klaar';
  let timer;
  const uit = await Promise.race([
    Promise.resolve(belofte).then(() => 'klaar', () => 'klaar'),
    new Promise((r) => { timer = setTimeout(() => r('time-out'), wachttijdMs); }),
  ]);
  clearTimeout(timer);
  return uit;
}

/**
 * Mag er opgeslagen worden? Wacht eerst op een lopende verificatie en stelt
 * `vraag` alleen als er handtekeningen in gevaar zijn. Eén vraag per document
 * tegelijk: een tweede opslag terwijl de vraag openstaat krijgt hetzelfde
 * antwoord.
 */
export async function beslisOpslaanVraag(doc, vraag, { wachttijdMs = WACHTTIJD_MS } = {}) {
  if (!doc) return true;
  if (doc._handtekeningVraag) return doc._handtekeningVraag;
  const beslissing = (async () => {
    await wachtOpVerificatie(doc, wachttijdMs);
    if (!handtekeningenInGevaar(doc)) return true;
    return !!(await vraag());
  })();
  doc._handtekeningVraag = beslissing;
  try {
    return await beslissing;
  } finally {
    if (doc._handtekeningVraag === beslissing) doc._handtekeningVraag = null;
  }
}

/** Na opslaan opnieuw verifiëren: de oude uitkomst gold voor het oude bestand. */
export function moetOpnieuwVerifieren(doc) {
  if (!doc) return false;
  if (doc._handtekeningBelofte) return true;
  return !!doc.handtekeningToestand && doc.handtekeningToestand !== 'geen';
}

function vergelijkbaarPad(pad) {
  return String(pad || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

/**
 * Welke vraag hoort bij opslaan naar `doelPad`? 'kopie' als het een ander
 * bestand is dan het ondertekende origineel (dat blijft dan ondertekend),
 * anders 'overschrijven'. Paden worden zonder hoofdlettergevoeligheid en met
 * beide soorten schuine strepen vergeleken.
 */
export function opslaanVraagSoort(doc, doelPad) {
  const origineel = doc?.saveTargetPath || doc?.filePath;
  if (!doelPad || !origineel || doc?.isUntitled) return 'overschrijven';
  return vergelijkbaarPad(doelPad) === vergelijkbaarPad(origineel) ? 'overschrijven' : 'kopie';
}

/** Verzenden per e-mail: alleen opslaan als het bestand op schijf niet actueel is. */
export function moetOpslaanVoorVerzenden(doc) {
  return !!doc && (!!doc.modified || !!doc.isUntitled || !doc.filePath);
}

/** Bestandsnaam met `.pdf` uit een tabbladnaam, zonder tekens die geen bestandsnaam mogen zijn. */
export function voorgesteldeBestandsnaam(naam) {
  const kaal = String(naam || '')
    .replace(/\.pdf\b/gi, '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return `${kaal || 'document'}.pdf`;
}

/**
 * Standaardpad voor "Opslaan als". Een naamloos document (ook het tabblad van
 * een ondertekende versie) staat in een tijdelijk bestand: stel dan de
 * tabbladnaam voor in `doc._voorgesteldeMap` of anders `map`.
 */
export function opslaanAlsStandaardPad(doc, map) {
  if (doc && !doc.isUntitled && (doc.saveTargetPath || doc.filePath)) {
    return doc.saveTargetPath || doc.filePath;
  }
  const naam = voorgesteldeBestandsnaam(doc?.fileName);
  const basis = doc?._voorgesteldeMap || map;
  if (!basis) return naam;
  const sep = basis.includes('\\') ? '\\' : '/';
  return /[\\/]$/.test(basis) ? `${basis}${naam}` : `${basis}${sep}${naam}`;
}

/**
 * Index van het actieve tabblad na sluiten (`documenten` zonder het gesloten
 * document): het eerder actieve document als dat er nog is, anders het vorige.
 */
export function actiefNaSluiten(documenten, geslotenIndex, vorigActief) {
  if (!documenten.length) return -1;
  const i = documenten.indexOf(vorigActief);
  if (i !== -1) return i;
  return Math.min(Math.max(0, geslotenIndex - 1), documenten.length - 1);
}

/** Vergelijkbare samenvatting van een verificatie-uitkomst (sluiten van de balk geldt per uitkomst). */
export function uitkomstSleutel(toestand, lijst, fout) {
  const items = (lijst || []).map((h) => [
    h?.nummer ?? null,
    h?.soort ?? null,
    h?.status?.code ?? null,
    h?.status?.reden ?? null,
    h?.integriteit?.uitkomst ?? null,
    !!h?.daarnaGewijzigd,
  ]);
  return JSON.stringify([toestand || null, items, fout || '']);
}
