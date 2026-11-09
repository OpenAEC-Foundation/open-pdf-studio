// Delen / verzenden (#952, #953): het actieve document naar een andere app.
//
//  - Android: het deelvenster van het systeem (mail met bijlage, Drive,
//    berichten-apps), via window.OpdsAndroid.share (src-tauri/android/
//    MainActivity.kt) met een kopie in de cachemap van de app.
//  - Windows: het standaard-mailprogramma opent een concept met de PDF als
//    bijlage (Simple MAPI, src-tauri/src/email.rs). Zonder MAPI-programma:
//    een mailconcept en het bestand in de Verkenner, om erin te slepen.
//  - Linux: xdg-email --attach, met dezelfde terugval.
//  - macOS: het bestand in Finder plus een mailconcept (geen bijlageweg
//    zonder eigen systeemkoppeling).
//  - browser: Web Share met het bestand, anders een mailconcept.
//
// Niet-opgeslagen wijzigingen: eerst vragen. "Opslaan en verzenden" slaat op
// en verzendt het bestand; "Kopie verzenden" verzendt een tijdelijke kopie
// met de wijzigingen (dezelfde bytes als opslaan zou schrijven) en laat het
// bestand op schijf ongemoeid. Een ongewijzigd bestand gaat zoals het is, zo
// blijven handtekeningen geldig. De app verstuurt zelf nooit iets: er opent
// alleen een concept of het deelvenster. De keuzes zelf staan in
// delen-keuze.js.

import i18next from '../i18n/config.js';
import { getActiveDocument } from '../core/state.js';
import { isTauri, invoke, readBinaryFile } from '../core/platform.js';
import { showMessage } from '../solid/stores/dialogStore.js';
import {
  deelRoute, deelBron, stapNaKeuze, verzendNaam, routeVraagtBytes, isGeenMailprogramma,
} from './delen-keuze.js';

const t = (sleutel, opties) => i18next.t(sleutel, opties);

function osType() {
  try { return window.__TAURI__?.os?.type?.() || null; } catch { return null; }
}

/** De route voor deze omgeving (zie deelRoute). */
export function huidigeDeelRoute() {
  const tauri = isTauri();
  return deelRoute({
    tauri,
    os: tauri ? osType() : null,
    androidBrug: typeof globalThis.OpdsAndroid?.share === 'function',
    webShare: typeof navigator !== 'undefined' && typeof navigator.canShare === 'function'
      && typeof navigator.share === 'function',
  });
}

/** Niet-opgeslagen wijzigingen: opslaan, een kopie of annuleren. */
async function vraagBijWijzigingen(doc) {
  const { kiesUitKnoppen } = await import('./host-opslaan-als-ui.js');
  const keuze = await kiesUitKnoppen({
    title: t('share.unsavedTitle'),
    message: t('share.unsavedMessage', { name: verzendNaam(doc) }),
    knoppen: [
      { id: 'opslaan', label: t('share.saveAndSend'), primair: true },
      { id: 'kopie', label: t('share.sendCopy') },
      { id: null, label: t('cancel') },
    ],
  });
  return stapNaKeuze(keuze);
}

/** De huidige inhoud als bytes, zonder iets weg te schrijven (saver.js). */
async function huidigeBytes(doc) {
  const { bouwMomentopname } = await import('./saver.js');
  return bouwMomentopname(doc);
}

/**
 * De bytes van een ongewijzigd bestand. Een PDF die op Android via de
 * bestandskiezer van de webview binnenkwam, heeft alleen een weergavenaam
 * als pad: dan de geladen bytes uit de cache van de lader, en anders de
 * huidige inhoud.
 */
async function bestandsBytes(doc, pad) {
  try {
    const data = await readBinaryFile(pad);
    if (data) return data instanceof Uint8Array ? data : new Uint8Array(data);
  } catch (e) {
    console.warn('[delen] bestand niet te lezen, terugval op de geladen bytes:', e);
  }
  const { getCachedPdfBytes } = await import('./loader.js');
  const geladen = getCachedPdfBytes(doc.filePath) || getCachedPdfBytes(`__memory__${doc.id}`);
  if (geladen) return geladen instanceof Uint8Array ? geladen : new Uint8Array(geladen);
  return huidigeBytes(doc);
}

/** Zet de bytes in de verzendmap van de app (email.rs) en geef het pad. */
async function schrijfVerzendkopie(naam, bytes) {
  const android = osType() === 'android';
  // Android kent geen rauwe IPC-body (zelfde als write_file_atomic).
  return invoke('verzendkopie_schrijven', android ? { data: Array.from(bytes) } : bytes, {
    headers: { 'x-opds-name': encodeURIComponent(naam) },
  });
}

async function deelViaAndroid(pad, naam) {
  const fout = globalThis.OpdsAndroid.share(pad, 'application/pdf', t('share.share'));
  if (fout) throw new Error(fout);
  return naam;
}

async function deelViaWebShare(bytes, naam) {
  const bestand = new File([bytes], naam, { type: 'application/pdf' });
  if (!navigator.canShare({ files: [bestand] })) return false;
  try {
    await navigator.share({ files: [bestand], title: naam });
  } catch (e) {
    // Annuleren in het deelvenster is geen fout. Een geweigerde Web Share
    // (bv. in het iframe van een gastsite) valt terug op het mailconcept.
    if (e?.name === 'AbortError') return true;
    console.warn('[delen] Web Share geweigerd, terugval:', e);
    return false;
  }
  return true;
}

/** Terugval zonder bijlage: mailconcept, en op de desktop het bestand tonen. */
async function terugval(pad, { tonen }) {
  const { openMailConcept } = await import('./email-pdf.js');
  if (tonen && pad) {
    const { revealInFileManager } = await import('../core/file-manager-reveal.js');
    await revealInFileManager(pad);
  }
  await openMailConcept(pad);
  if (tonen && pad) showMessage(t('share.attachManually', { path: pad }));
}

/**
 * Deel of verzend het actieve document. Geeft true als het concept of het
 * deelvenster opende (of de terugval), false bij annuleren of een fout.
 */
export async function deelHuidigDocument() {
  let doc = getActiveDocument();
  let bron = deelBron(doc);
  if (bron.soort === 'geen') {
    showMessage(t('noPdfLoaded'));
    return false;
  }
  if (bron.soort === 'vraag') {
    const stap = await vraagBijWijzigingen(doc);
    if (!stap) return false;
    if (stap === 'opslaan') {
      const { savePDF } = await import('./saver.js');
      if (!(await savePDF())) return false;
      // Opslaan als kan een ander document actief maken; dat is wat er nu staat.
      doc = getActiveDocument();
      bron = deelBron(doc);
      if (bron.soort === 'vraag' || bron.soort === 'geen') return false;
    } else {
      bron = { soort: 'kopie' };
    }
  }

  const route = huidigeDeelRoute();
  const naam = verzendNaam(doc);
  let pad = bron.soort === 'bestand' ? bron.pad : null;
  let bytes = null;
  try {
    if (bron.soort === 'kopie') {
      bytes = await huidigeBytes(doc);
    } else if (routeVraagtBytes(route)) {
      bytes = await bestandsBytes(doc, pad);
    }
  } catch (e) {
    showMessage(t('share.copyFailed', { error: String(e?.message ?? e) }));
    return false;
  }

  try {
    if (route === 'web-share') {
      if (await deelViaWebShare(bytes, naam)) return true;
      await terugval(null, { tonen: false });
      return true;
    }
    if (route === 'mailto') {
      await terugval(pad, { tonen: false });
      return true;
    }
    // Desktop en Android: een kopie komt als bestand in de verzendmap.
    if (bytes) pad = await schrijfVerzendkopie(naam, bytes);
    if (route === 'android') {
      await deelViaAndroid(pad, naam);
      return true;
    }
    if (route === 'mapi' || route === 'xdg-email') {
      try {
        await invoke('email_pdf', { path: pad, subject: naam });
        return true;
      } catch (e) {
        if (!isGeenMailprogramma(e)) throw e;
        console.warn('[delen] geen mailprogramma voor de bijlage, terugval:', e);
      }
    }
    await terugval(pad, { tonen: true });
    return true;
  } catch (e) {
    showMessage(t('share.failed', { error: String(e?.message ?? e) }));
    return false;
  }
}

/**
 * Een gegeven PDF (bytes) als bijlage in een mailconcept met ontvangers,
 * onderwerp en tekst: de provider mail-v1 van de goedkeuringsroutes (#651).
 * Dezelfde wegen als hierboven; de app verstuurt zelf niets, er opent een
 * concept dat de gebruiker in het mailprogramma verstuurt. Zonder weg voor
 * een bijlage: het mailconcept met ontvangers en tekst, en het bestand in
 * de bestandsbeheerder (of als download in de browser) om erin te slepen.
 * Geeft de gebruikte route.
 */
export async function verzendBijlagePerMail({ naam, bytes, onderwerp, aan = [], tekst = '' }) {
  const route = huidigeDeelRoute();
  const { buildMailtoUrl } = await import('./email-pdf.js');
  const { openExtern } = await import('../core/extern-openen.js');
  const concept = () => openExtern(buildMailtoUrl(onderwerp, tekst, aan));
  if (route === 'web-share') {
    if (await deelViaWebShare(bytes, naam)) return route;
  }
  if (route === 'web-share' || route === 'mailto') {
    const { downloadBestand } = await import('../core/platform.js');
    downloadBestand(naam, bytes);
    await concept();
    return 'mailto';
  }
  const pad = await schrijfVerzendkopie(naam, bytes);
  if (route === 'android') {
    await deelViaAndroid(pad, naam);
    return route;
  }
  if (route === 'mapi' || route === 'xdg-email') {
    try {
      await invoke('email_pdf', { path: pad, subject: onderwerp, to: aan, body: tekst });
      return route;
    } catch (e) {
      if (!isGeenMailprogramma(e)) throw e;
      console.warn('[delen] geen mailprogramma voor de bijlage, terugval:', e);
    }
  }
  const { revealInFileManager } = await import('../core/file-manager-reveal.js');
  await revealInFileManager(pad);
  await concept();
  showMessage(t('share.attachManually', { path: pad }));
  return 'tonen';
}
