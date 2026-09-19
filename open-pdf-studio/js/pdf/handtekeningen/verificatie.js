// Handtekeningen van een geopend document laten verifiëren (Rust:
// pdf_signature_list) en de balk boven de pagina bijwerken. Start alleen bij
// handtekeningvelden (spec §7.3); het openen wacht hier niet op.
import { state } from '../../core/state.js';
import { invoke, isTauri } from '../../core/platform.js';
import i18next from '../../i18n/config.js';
import {
  foutSleutel, heeftHandtekeningvelden, isGewijzigdSindsLijst, ondertekendeVersieArgumenten,
} from './weergave.js';
import {
  beslisOpslaanVraag, handtekeningenInGevaar, opslaanVraagSoort, uitkomstSleutel, wachtOpVerificatie,
} from './opslaan.js';
import { toonHandtekeningBalk, verbergHandtekeningBalk } from '../../solid/stores/handtekeningBarStore.js';

function isActief(doc) {
  return state.documents[state.activeDocumentIndex] === doc;
}

/** Leesbare tekst voor een fout van pdf_signature_list of pdf_signed_revision. */
export function foutTekst(fout) {
  const sleutel = foutSleutel(fout);
  if (sleutel) return i18next.t(`dialogs:${sleutel}`);
  return fout?.detail || fout?.code || String(fout);
}

/** Zet de balk voor het document in het actieve tabblad (of verbergt hem). */
export function toonBalkVoorActiefDocument() {
  const doc = state.documents[state.activeDocumentIndex];
  const toestand = doc?.handtekeningToestand;
  if (!doc || doc.handtekeningBalkGesloten || !toestand || toestand === 'geen') {
    verbergHandtekeningBalk();
    return;
  }
  toonHandtekeningBalk({ toestand, items: doc.handtekeningen || [], fout: doc.handtekeningFout || '' });
}

export function sluitBalkVoorActiefDocument() {
  const doc = state.documents[state.activeDocumentIndex];
  if (doc) doc.handtekeningBalkGesloten = true;
  toonBalkVoorActiefDocument();
}

/**
 * Verifieert de handtekeningen van `doc` in het bestand `pad` (standaard het
 * bestand achter het document). Slaat over zonder handtekeningvelden. De
 * lopende belofte staat op `doc._handtekeningBelofte`, zodat opslaan erop kan
 * wachten.
 */
export function verifieerHandtekeningen(doc, pad = null) {
  if (!doc) return Promise.resolve();
  const belofte = verifieer(doc, pad);
  doc._handtekeningBelofte = belofte;
  const opruimen = () => { if (doc._handtekeningBelofte === belofte) doc._handtekeningBelofte = null; };
  belofte.then(opruimen, opruimen);
  return belofte;
}

/** Legt een eindtoestand vast; een andere uitkomst dan de vorige opent een gesloten balk weer. */
function zetUitkomst(doc, toestand, lijst, fout) {
  doc.handtekeningToestand = toestand;
  doc.handtekeningen = lijst;
  doc.handtekeningFout = fout;
  const sleutel = uitkomstSleutel(toestand, lijst, fout);
  if (doc._handtekeningUitkomst !== undefined && doc._handtekeningUitkomst !== sleutel) {
    doc.handtekeningBalkGesloten = false;
  }
  doc._handtekeningUitkomst = sleutel;
}

async function verifieer(doc, pad) {
  // Het nieuwe verzoek maakt de uitkomst van een eerder, nog lopend verzoek
  // ongeldig — ook als dit verzoek hieronder direct stopt.
  const verzoek = (doc._handtekeningVerzoek || 0) + 1;
  doc._handtekeningVerzoek = verzoek;
  if (!isTauri()) return;
  const bron = pad || doc.saveTargetPath || doc.filePath;
  if (!bron || String(bron).startsWith('__memory__') || !doc.pdfDoc) return;
  const heeft = await heeftHandtekeningvelden(doc.pdfDoc);
  if (doc._handtekeningVerzoek !== verzoek) return;
  if (!heeft) {
    zetUitkomst(doc, 'geen', null, '');
    if (isActief(doc)) toonBalkVoorActiefDocument();
    return;
  }
  doc.handtekeningToestand = 'bezig';
  if (isActief(doc)) toonBalkVoorActiefDocument();
  try {
    const lijst = await invoke('pdf_signature_list', { pad: bron });
    if (doc._handtekeningVerzoek !== verzoek) return;
    const items = Array.isArray(lijst) ? lijst : [];
    // Geen enkel item (bv. velden die pdf.js wel en de verifier niet ziet):
    // niets te tonen, dus ook geen lege balk.
    if (items.length === 0) zetUitkomst(doc, 'geen', [], '');
    else zetUitkomst(doc, 'klaar', items, '');
  } catch (e) {
    if (doc._handtekeningVerzoek !== verzoek) return;
    console.warn('[handtekening] verifiëren mislukt:', e);
    zetUitkomst(doc, 'fout', [], foutTekst(e));
  }
  if (isActief(doc)) toonBalkVoorActiefDocument();
}

/** Detailvenster voor één handtekening (spec §3.2). */
export function openHandtekeningDetails(info) {
  import('../../solid/stores/dialogStore.js').then(m => m.openDialog('handtekening-detail', { info }));
}

/**
 * Opent de bytes tot het einde van het bytebereik van handtekening `info` (een
 * regel uit de lijst: `nummer` en `bereikEinde`) als nieuw, tijdelijk tabblad
 * ("Toon ondertekende versie", spec §7.2). Het tijdelijke bestand staat in de
 * cachemap van de app; sluiten van het tabblad verwijdert het (naamloos
 * document, zie closeTab).
 */
export async function openOndertekendeVersie(info) {
  const doc = state.documents[state.activeDocumentIndex];
  if (!doc || !isTauri() || !Number.isInteger(info?.nummer)) return;
  const { nummer } = info;
  const bron = doc.saveTargetPath || doc.filePath;
  let nieuw = null;
  try {
    const pad = await invoke('pdf_signed_revision', ondertekendeVersieArgumenten(bron, info));
    if (!pad) return;
    const { createTab, updateWindowTitle } = await import('../../ui/chrome/tabs.js');
    const { loadPDF } = await import('../loader.js');
    const { index } = createTab(pad);
    nieuw = state.documents[index];
    if (nieuw) {
      // Vóór loadPDF: dan slaat het laden recente bestanden over.
      nieuw.isUntitled = true;
      // "Opslaan als" stelt de map van het origineel voor, niet de tijdelijke map.
      nieuw._voorgesteldeMap = mapVan(bron);
    }
    await loadPDF(pad, index);
    // loadPDF meldt zelf een leesfout en gooit niet: dan het lege tabblad sluiten.
    if (!nieuw?.pdfDoc) {
      await sluitTabblad(nieuw);
      return;
    }
    nieuw.fileName = i18next.t('dialogs:signatureVerification.signedVersionTab', {
      name: doc.fileName,
      number: nummer + 1,
    });
    updateWindowTitle();
  } catch (e) {
    console.warn('[handtekening] ondertekende versie openen mislukt:', e);
    await sluitTabblad(nieuw);
    const { showMessage } = await import('../../bridge.js');
    if (isGewijzigdSindsLijst(e)) {
      // De lijst in de balk hoort bij een oudere stand van het bestand:
      // melden en opnieuw controleren, zodat de balk weer klopt.
      showMessage(i18next.t('dialogs:signatureVerification.changedSinceCheck'));
      if (state.documents.includes(doc)) verifieerHandtekeningen(doc);
      return;
    }
    showMessage(i18next.t('dialogs:signatureVerification.signedVersionError', { detail: foutTekst(e) }));
  }
}

function mapVan(pad) {
  const s = String(pad || '');
  const i = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return i > 0 ? s.slice(0, i) : null;
}

async function sluitTabblad(nieuw) {
  if (!nieuw) return;
  const index = state.documents.indexOf(nieuw);
  if (index === -1) return;
  try {
    const { closeTab } = await import('../../ui/chrome/tabs.js');
    await closeTab(index, true);
  } catch (e) {
    console.warn('[handtekening] leeg tabblad sluiten mislukt:', e);
  }
}

/**
 * Vraagt bevestiging voordat een document met handtekeningen gewoon wordt
 * opgeslagen: de saver herschrijft het bestand, waardoor de handtekeningen
 * ongeldig worden (spec §3.2). Naar een ander pad (`doelPad`, "Opslaan als")
 * blijft het origineel ondertekend en gaat de vraag over de kopie. Wacht op
 * een lopende verificatie.
 */
export async function bevestigOpslaanMetHandtekeningen(doc, doelPad = null) {
  return beslisOpslaanVraag(doc, () => {
    const titel = i18next.t('dialogs:signatureVerification.save.title');
    const bericht = opslaanVraagSoort(doc, doelPad) === 'kopie'
      ? i18next.t('dialogs:signatureVerification.save.messageCopy')
      : i18next.t('dialogs:signatureVerification.save.message');
    if (window.__TAURI__?.dialog?.ask) {
      return window.__TAURI__.dialog.ask(bericht, {
        title: titel,
        kind: 'warning',
        okLabel: i18next.t('dialogs:signatureVerification.save.confirm'),
        cancelLabel: i18next.t('common:cancel'),
      });
    }
    return window.confirm(bericht);
  });
}

/** Zonder vraag (MCP-brug): worden er handtekeningen ongeldig bij opslaan? */
export async function opslaanMaaktHandtekeningenOngeldig(doc) {
  await wachtOpVerificatie(doc);
  return handtekeningenInGevaar(doc);
}
