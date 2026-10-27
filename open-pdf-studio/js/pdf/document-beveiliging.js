// Documentbeveiliging (#378): de pure regels. Geen state, geen DOM, geen
// imports, zodat wachtwoord-pdf.js, de saver, de dialoog en de eigenschappen
// ze kunnen gebruiken en node:test ze los toetst.
//
// `doc.beveiliging` beschrijft de beveiliging die het document bij het
// VOLGENDE opslaan krijgt (zolang er niets gewijzigd is: die van het bestand):
//   {
//     versleuteld: boolean,       // false = opslaan schrijft zonder beveiliging
//     sessie: string|null,        // naam van de Rust-sessie die versleutelt;
//                                 // null bij een oudere methode (RC4, AES-128)
//     methode, revisie, p, rechten,
//     eigenaarToegang: boolean,   // met het rechtenwachtwoord ontgrendeld
//     openWachtwoord: boolean,    // opent alleen met een wachtwoord
//     magWijzigen: boolean,       // wijzigen zonder eerst het rechtenwachtwoord
//     inAfwachting: boolean,      // gewijzigd, nog niet opgeslagen
//   }
// Geen `doc.beveiliging`: het document is niet versleuteld.

/** Bit (1 = laagste) per recht in /P (ISO 32000-2, tabel 22). */
export const RECHT_BITS = Object.freeze({
  print: 3,
  wijzigen: 4,
  kopieren: 5,
  annoteren: 6,
  formulieren: 9,
  toegankelijkheid: 10,
  samenstellen: 11,
  printHogeKwaliteit: 12,
});

/** De rechten in de volgorde van de dialoog en de eigenschappen, met hun i18n-sleutel (dialogs). */
export const RECHTEN_LIJST = Object.freeze([
  ['print', 'protectPdf.allowPrint'],
  ['printHogeKwaliteit', 'protectPdf.allowPrintHigh'],
  ['kopieren', 'protectPdf.allowCopy'],
  ['toegankelijkheid', 'protectPdf.allowAccessibility'],
  ['wijzigen', 'protectPdf.allowEdit'],
  ['annoteren', 'protectPdf.allowAnnotate'],
  ['formulieren', 'protectPdf.allowForms'],
  ['samenstellen', 'protectPdf.allowAssemble'],
]);

/**
 * De /P-waarde (32 bits met teken, zoals in het bestand) voor deze rechten:
 * bits 7, 8 en 13-32 aan, 1 en 2 uit (gelijk aan Rechten::bits in Rust).
 */
export function rechtenNaarP(rechten) {
  let p = 0xFFFFF0C0;
  for (const [sleutel, bit] of Object.entries(RECHT_BITS)) {
    if (rechten?.[sleutel]) p |= 1 << (bit - 1);
  }
  return p | 0;
}

/** De rechten die een /P-waarde geeft. */
export function rechtenUitP(p) {
  const uit = {};
  for (const [sleutel, bit] of Object.entries(RECHT_BITS)) uit[sleutel] = ((p >>> (bit - 1)) & 1) === 1;
  return uit;
}

/** Geen enkele beperking? */
export function allesToegestaan(rechten) {
  return !!rechten && Object.keys(RECHT_BITS).every((k) => rechten[k] === true);
}

/** Zelfde rechten? */
export function zelfdeRechten(a, b) {
  return !!a && !!b && Object.keys(RECHT_BITS).every((k) => !!a[k] === !!b[k]);
}

/**
 * `doc.beveiliging` uit het antwoord van Rust (SessieInfo).
 * @param {{handle?:string|null, methode?:string, revisie?:number, p?:number, rechten?:object,
 *   eigenaarToegang?:boolean, openWachtwoord?:boolean, magWijzigen?:boolean}|null} info
 */
export function beveiligingUitSessie(info, { inAfwachting = false } = {}) {
  if (!info) return null;
  const rechten = info.rechten ? { ...info.rechten } : (Number.isFinite(info.p) ? rechtenUitP(info.p) : null);
  return {
    versleuteld: true,
    sessie: info.handle || null,
    methode: info.methode || null,
    revisie: Number.isFinite(info.revisie) ? info.revisie : null,
    p: Number.isFinite(info.p) ? info.p : null,
    rechten,
    eigenaarToegang: info.eigenaarToegang === true,
    openWachtwoord: info.openWachtwoord === true,
    magWijzigen: info.magWijzigen === true || info.eigenaarToegang === true,
    inAfwachting,
  };
}

/**
 * Een versleuteld bestand waarvan de beveiliging niet te lezen was: het
 * document opent, maar opslaan kan de beveiliging niet behouden.
 */
export function onbekendeBeveiliging({ openWachtwoord = false } = {}) {
  return {
    versleuteld: true, sessie: null, methode: null, revisie: null, p: null, rechten: null,
    eigenaarToegang: false, openWachtwoord, magWijzigen: false, inAfwachting: false,
  };
}

/** Krijgt dit document bij opslaan een beveiliging? */
export function isVersleuteld(doc) {
  return !!doc?.beveiliging?.versleuteld;
}

/**
 * Kan opslaan de beveiliging schrijven? Niet versleuteld kan altijd; een
 * versleuteld doel alleen met een sessie (dus niet bij een oudere methode
 * die nog niet vervangen is).
 */
export function kanBeveiligingSchrijven(doc) {
  const b = doc?.beveiliging;
  return !b || !b.versleuteld || !!b.sessie;
}

/**
 * Mag de beveiliging gewijzigd of verwijderd worden? Met het
 * rechtenwachtwoord altijd; met alleen het openwachtwoord als het bestand
 * geen enkele beperking heeft.
 */
export function magBeveiligingWijzigen(b) {
  if (!b || !b.versleuteld) return true;
  return b.eigenaarToegang === true || b.magWijzigen === true || allesToegestaan(b.rechten);
}

/**
 * Laten de rechten geen bewerking toe? Zonder het recht om de inhoud te
 * wijzigen en zonder het recht om te annoteren is het document alleen-lezen
 * (wie het rechtenwachtwoord gaf, mag alles).
 */
export function beperktDoorRechten(doc) {
  const b = doc?.beveiliging;
  if (!b?.versleuteld || b.eigenaarToegang || !b.rechten) return false;
  return !b.rechten.wijzigen && !b.rechten.annoteren;
}

/** Mag dit document geprint worden? */
export function magPrinten(doc) {
  const b = doc?.beveiliging;
  if (!b?.versleuteld || b.eigenaarToegang || !b.rechten) return true;
  return b.rechten.print === true;
}

/**
 * Wat "OK" in de beveiligingsdialoog doet.
 * @param {object} invoer
 * @param {object|null} invoer.huidig     doc.beveiliging
 * @param {'geen'|'wachtwoord'} invoer.keuze
 * @param {string} invoer.gebruiker       nieuw openwachtwoord ('' = geen)
 * @param {string} invoer.eigenaar        nieuw rechtenwachtwoord ('' = geen)
 * @param {object} invoer.rechten
 * @returns {{soort:'niets'|'verwijder'|'nieuw'|'rechten'}|{fout:string}} fout = i18n-sleutel (dialogs)
 */
export function bepaalWijziging({ huidig, keuze, gebruiker, eigenaar, rechten }) {
  const versleuteld = !!huidig?.versleuteld;
  let soort;
  if (keuze === 'geen') {
    soort = versleuteld ? 'verwijder' : 'niets';
  } else if (gebruiker || eigenaar) {
    soort = 'nieuw';
  } else if (!versleuteld) {
    return { fout: 'protectPdf.needPassword' };
  } else if (huidig.rechten && zelfdeRechten(huidig.rechten, rechten)) {
    soort = 'niets';
  } else if (!huidig.sessie) {
    // Oudere methode: de app kan alleen nieuwe wachtwoorden schrijven.
    return { fout: 'protectPdf.olderMethodInfo' };
  } else {
    soort = 'rechten';
  }
  if (soort !== 'niets' && versleuteld && !magBeveiligingWijzigen(huidig)) {
    return { fout: 'protectPdf.ownerPasswordHint' };
  }
  return { soort };
}

/**
 * Wat de documenteigenschappen over de beveiliging tonen.
 * @returns {{versleuteld:boolean, methode:string|null, openWachtwoord:boolean,
 *   rechten:string[]|null, alles:boolean, volledigeToegang:boolean, inAfwachting:boolean}}
 *   rechten = de sleutels van de toegestane rechten (RECHTEN_LIJST-volgorde)
 */
export function beschrijfBeveiliging(b) {
  if (!b) {
    return { versleuteld: false, methode: null, openWachtwoord: false, rechten: null, alles: true, volledigeToegang: true, inAfwachting: false };
  }
  const rechten = b.rechten ? RECHTEN_LIJST.map(([k]) => k).filter((k) => b.rechten[k]) : null;
  return {
    versleuteld: !!b.versleuteld,
    methode: b.versleuteld ? (b.methode || null) : null,
    openWachtwoord: !!b.versleuteld && !!b.openWachtwoord,
    rechten: b.versleuteld ? rechten : null,
    alles: !b.versleuteld || allesToegestaan(b.rechten),
    volledigeToegang: !b.versleuteld || !!b.eigenaarToegang || allesToegestaan(b.rechten),
    inAfwachting: !!b.inAfwachting,
  };
}
