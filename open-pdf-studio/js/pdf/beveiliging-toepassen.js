// Documentbeveiliging (#378): wat de beveiligingsdialoog en de saver met Rust
// doen. De regels staan in document-beveiliging.js; de sleutels en
// wachtwoorden blijven in Rust (src-tauri/src/pdf_beveiliging.rs), de JS kent
// alleen de naam van een sessie.
//
// Een wijziging geldt bij het volgende opslaan: de dialoog zet
// `doc.beveiliging` en markeert het document als gewijzigd; de saver schrijft
// met de sessie (writeProtectedPdfAtomic) of, zonder beveiliging, gewoon.

import { invoke, isTauri } from '../core/platform.js';
import {
  beveiligingUitSessie, bepaalWijziging, magBeveiligingWijzigen, isVersleuteld,
} from './document-beveiliging.js';
import { bronPad } from './wachtwoord-pdf.js';

/** Houdt de sessies van een document bij, om ze bij het sluiten vrij te geven. */
export function onthoudSessie(doc, handle) {
  if (!doc || !handle) return;
  if (!Array.isArray(doc._beveiligingSessies)) doc._beveiligingSessies = [];
  if (!doc._beveiligingSessies.includes(handle)) doc._beveiligingSessies.push(handle);
}

/** Bij het sluiten van een tabblad: de sessies in Rust vergeten. */
export async function geefSessiesVrij(doc) {
  const handles = Array.isArray(doc?._beveiligingSessies) ? [...doc._beveiligingSessies] : [];
  if (doc) doc._beveiligingSessies = [];
  if (!handles.length || !isTauri()) return;
  try {
    await invoke('pdf_security_release', { handles });
  } catch (e) {
    console.warn('[beveiliging] sessies niet vrijgegeven:', e?.message || e);
  }
}

/**
 * Ontgrendelt de huidige beveiliging met het rechtenwachtwoord.
 * @returns {Promise<boolean>} false bij een verkeerd wachtwoord
 */
export async function ontgrendelEigenaar(doc, wachtwoord) {
  const b = doc?.beveiliging;
  if (!b?.versleuteld) return true;
  if (b.sessie) {
    try {
      const info = await invoke('pdf_security_unlock_owner', { handle: b.sessie, wachtwoord });
      doc.beveiliging = { ...beveiligingUitSessie(info), inAfwachting: b.inAfwachting };
      return true;
    } catch (e) {
      if (String(e?.message ?? e).startsWith('WRONG_PASSWORD')) return false;
      throw e;
    }
  }
  // Oudere methode: PDFium controleert het wachtwoord op het origineel.
  const pad = doc.originalFilePath || bronPad(doc);
  const eigenaar = await invoke('verify_pdf_owner_password', { path: pad, password: wachtwoord });
  if (!eigenaar) return false;
  doc.beveiliging = { ...b, eigenaarToegang: true, magWijzigen: true };
  return true;
}

/**
 * Voert de keuze uit de beveiligingsdialoog uit.
 * @param {object} doc
 * @param {{keuze:'geen'|'wachtwoord', gebruiker:string, eigenaar:string, rechten:object, huidigWachtwoord?:string}} invoer
 * @returns {Promise<{ok:true, soort:string}|{ok:false, fout:string}>} fout = i18n-sleutel (dialogs)
 */
export async function pasBeveiligingToe(doc, invoer) {
  if (!doc) return { ok: false, fout: 'protectPdf.failed' };
  if (isVersleuteld(doc) && !magBeveiligingWijzigen(doc.beveiliging) && invoer.huidigWachtwoord) {
    if (!(await ontgrendelEigenaar(doc, invoer.huidigWachtwoord))) {
      return { ok: false, fout: 'protectPdf.wrongOwnerPassword' };
    }
  }
  const plan = bepaalWijziging({
    huidig: doc.beveiliging || null,
    keuze: invoer.keuze,
    gebruiker: invoer.gebruiker || '',
    eigenaar: invoer.eigenaar || '',
    rechten: invoer.rechten,
  });
  if (plan.fout) return { ok: false, fout: plan.fout };

  if (plan.soort === 'verwijder') {
    doc.beveiliging = {
      versleuteld: false, sessie: null, methode: null, revisie: null, p: null, rechten: null,
      eigenaarToegang: true, openWachtwoord: false, magWijzigen: true, inAfwachting: true,
    };
  } else if (plan.soort === 'nieuw') {
    const info = await invoke('pdf_security_new', {
      gebruikerswachtwoord: invoer.gebruiker || '',
      eigenaarwachtwoord: invoer.eigenaar || '',
      rechten: invoer.rechten,
    });
    onthoudSessie(doc, info?.handle);
    doc.beveiliging = beveiligingUitSessie(info, { inAfwachting: true });
  } else if (plan.soort === 'rechten') {
    const info = await invoke('pdf_security_permissions', { handle: doc.beveiliging.sessie, rechten: invoer.rechten });
    onthoudSessie(doc, info?.handle);
    doc.beveiliging = beveiligingUitSessie(info, { inAfwachting: true });
  }
  if (plan.soort !== 'niets') {
    const { markDocumentModified } = await import('../ui/chrome/tabs.js');
    markDocumentModified(doc);
  }
  return { ok: true, soort: plan.soort };
}

/** De sessie waarmee opslaan versleutelt, of null (gewoon schrijven). */
export function sessieVoorOpslaan(doc) {
  const b = doc?.beveiliging;
  if (!b?.versleuteld) return null;
  if (!b.sessie) throw new Error('PROTECTION_NOT_WRITABLE');
  return b.sessie;
}

/** Na een geslaagde save: de beveiliging staat nu zo in het bestand. */
export function naOpslaanBeveiliging(doc) {
  const b = doc?.beveiliging;
  if (!b) return;
  if (!b.versleuteld) {
    // Zonder beveiliging opgeslagen: na een herstart opent het gewoon.
    doc.beveiliging = null;
    doc.passwordProtected = false;
    return;
  }
  if (b.inAfwachting) doc.beveiliging = { ...b, inAfwachting: false };
}
