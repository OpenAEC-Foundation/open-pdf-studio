// Alles vlakken / alles terughalen (#615) — de opdrachten op het geopende
// document.
//
// Vlakken werkt op het document zoals het nu is, niet op het bestand op schijf:
// de saver bouwt het document met alle markeringen (en hun appearances) in
// het geheugen, flatten-bytes.js zet die appearances in de pagina-inhoud, en
// het document wordt uit die bytes herladen, net als bij een paginabewerking.
// Daardoor is het één stap die ongedaan gemaakt kan worden (Ctrl+Z), en komt
// het pas bij opslaan in het bestand — zoals elke andere bewerking.
//
// Terughalen is het spiegelbeeld: de gevlakte blokken van herstelbare
// partijen uit de pagina-inhoud, de markeringen uit de herstelkopie terug in
// het model. Ze staan daarna weer als gewone markeringen in het document en
// gaan bij de volgende save als annotaties het bestand in.

import { getActiveDocument, state } from '../core/state.js';
import i18next from '../i18n/config.js';
import { showMessage } from '../bridge.js';

/**
 * Een schaalgebied is een meethulp van de app, geen tekening: het blijft bij
 * vlakken een markering (en houdt zo zijn kalibratie), ook nu het een
 * appearance heeft (#611). Daarvoor had het geen appearance en bleef het om
 * die reden staan.
 * @param {import('pdf-lib').PDFDict} dict
 */
function isMeethulpDict(dict) {
  // Zonder pdf-lib te importeren (die laadt deze module pas bij gebruik).
  let v = null;
  for (const [sleutel, waarde] of dict?.entries?.() || []) {
    if (String(sleutel) === '/OPS_Subtype') { v = waarde; break; }
  }
  if (!v) return false;
  const tekst = typeof v.decodeText === 'function' ? v.decodeText() : String(v);
  return tekst === 'scaleRegion' || tekst === '(scaleRegion)';
}

/**
 * Welke annotaties in het opgebouwde document vlakken bakt: alleen wat de
 * saver uit het model schreef (objectnummer boven eersteNieuwObject), behalve
 * de meethulpen.
 * @param {number} eersteNieuwObject
 */
export function teVlakkenNa(eersteNieuwObject) {
  return (ref, dict) => ref.objectNumber > eersteNieuwObject && !isMeethulpDict(dict);
}

/**
 * Welke markeringen vlakken meeneemt. Een vastgezet knipsel staat al in de
 * pagina-inhoud (of komt er bij de volgende save in): dat hoort niet in de
 * herstelkopie, anders staat het na terughalen dubbel.
 * @param {object[]} annotaties
 * @returns {object[]}
 */
export function vlakbareAnnotaties(annotaties) {
  return (annotaties || []).filter((a) => a && !(a.type === 'vectorSnippet' && (a.flattened || a.gebakkenIn)));
}

/**
 * Teruggehaalde markeringen naast wat er nu in het document staat: een id dat
 * al bestaat (een markering die na het vlakken met dezelfde id is gemaakt)
 * krijgt een nieuw id, zodat selectie en ongedaan maken ze uit elkaar houden.
 * @param {object[]} bestaand
 * @param {object[]} terug
 * @param {() => string} [nieuwId]
 * @returns {object[]}
 */
export function voegTeruggehaaldToe(bestaand, terug, nieuwId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 11)) {
  const ids = new Set((bestaand || []).map((a) => a?.id));
  const uit = [...(bestaand || [])];
  for (const a of terug || []) {
    let kopie = { ...a };
    if (!kopie.id || ids.has(kopie.id)) kopie = { ...kopie, id: nieuwId() };
    ids.add(kopie.id);
    uit.push(kopie);
  }
  return uit;
}

function t(sleutel, opties) {
  return i18next.t(`ribbon:${sleutel}`, opties);
}

export async function huidigeBytes(doc) {
  const { getCachedPdfBytes } = await import('./loader.js');
  const sleutel = doc.filePath || `__memory__${doc.id}`;
  let bytes = getCachedPdfBytes(sleutel);
  if (!bytes && doc.filePath) {
    const { readBinaryFile } = await import('../core/platform.js');
    bytes = await readBinaryFile(doc.filePath);
  }
  return bytes ? new Uint8Array(bytes) : null;
}

/**
 * Laadt de annotaties van elke pagina in het model. Vlakken haalt ze daarna
 * allemaal weg; een pagina die nog niet geladen was, zou anders na de volgende
 * save haar annotaties kwijt zijn.
 */
export async function laadAlleAnnotaties(doc) {
  const { ensureAnnotationsForPage } = await import('./loader.js');
  const aantal = doc.pdfDoc?.numPages || 0;
  for (let p = 1; p <= aantal; p++) await ensureAnnotationsForPage(p, doc);
  const start = Date.now();
  const klaar = () => !doc._annotationPagesReady
    || Array.from({ length: aantal }, (_, i) => i + 1).every((p) => doc._annotationPagesReady.has(p));
  while (!klaar()) {
    if (Date.now() - start > 30_000 || !state.documents.includes(doc)) return false;
    await new Promise((r) => setTimeout(r, 20));
  }
  return true;
}

async function magBewerken(doc) {
  if (!doc?.pdfDoc) return false;
  const { opslaanGeweigerd } = await import('./wachtwoord-pdf.js');
  if (opslaanGeweigerd(doc)) {
    showMessage(i18next.t('protectedPdfReadOnly'));
    return false;
  }
  return true;
}

function vraagOpties(aantal) {
  return new Promise((resolve) => {
    import('../solid/stores/dialogStore.js').then(({ openDialog }) => {
      openDialog('flatten-all', { count: aantal, resolve });
    });
  });
}

async function meld(tekst) {
  try {
    const { updateStatusMessage } = await import('../ui/chrome/status-bar.js');
    updateStatusMessage(tekst, 5000);
  } catch { /* geen statusbalk */ }
}

/**
 * Alles vlakken.
 * @param {object} [opties]
 * @param {boolean} [opties.herstelbaar=true] terughalen mogelijk houden (herstelkopie in het bestand)
 * @param {boolean} [opties.vragen=true] eerst het venster tonen (bevestigen en de keuze voor herstel)
 * @returns {Promise<{ok:boolean, reden?:string, gebakken?:number, zonderUiterlijk?:number, herstelbaar?:boolean}>}
 */
export async function flattenAllMarkups({ herstelbaar = true, vragen = true, doc = getActiveDocument() } = {}) {
  if (!(await magBewerken(doc))) return { ok: false, reden: 'geen-document' };
  const { showLoading, hideLoading } = await import('../ui/chrome/dialogs.js');
  if (!(await laadAlleAnnotaties(doc))) {
    showMessage(t('flattenAll.notLoaded'));
    return { ok: false, reden: 'niet-geladen' };
  }
  const teVlakken = vlakbareAnnotaties(doc.annotations);
  if (teVlakken.length === 0) {
    showMessage(t('flattenAll.nothing'));
    return { ok: false, reden: 'geen-markeringen' };
  }
  if (vragen) {
    const keuze = await vraagOpties(teVlakken.length);
    if (!keuze?.ok) return { ok: false, reden: 'afgebroken' };
    herstelbaar = keuze.herstelbaar !== false;
  }
  if (!state.documents.includes(doc)) return { ok: false, reden: 'geen-document' };

  // Annuleren (#766): tot het herladen hieronder blijft het document zoals het
  // was; daarna is het niet meer te annuleren.
  const { maakOpslagAnnulering, isOpslagGeannuleerd } = await import('./saver/opslag-annuleren.js');
  const annulering = maakOpslagAnnulering();
  const toonVoortgang = () => showLoading(t('flattenAll.busy'), {
    annuleren: () => annulering.annuleer(), annulerenUit: !annulering.kanAnnuleren,
  });
  const stopVoortgang = annulering.opWijziging(toonVoortgang);
  toonVoortgang();
  try {
    const oudeBytes = await annulering.wacht(huidigeBytes(doc));
    if (!oudeBytes) throw new Error('no document bytes');
    const oudeAnnotaties = doc.annotations.map((a) => ({ ...a }));
    const oudeRotaties = { ...(doc.pageRotations || {}) };
    const pagina = doc.currentPage || 1;

    const { bouwAnnotatieDocument } = await import('./saver.js');
    const { vlakDocument, ruimOnbereikbaarOp } = await import('./flatten-bytes.js');
    const { pdfDocLib, eersteNieuwObject } = await bouwAnnotatieDocument(doc, { annulering });
    await annulering.punt();
    // Alleen wat deze bouw uit het model schreef (objectnummer boven
    // eersteNieuwObject): annotaties die de app niet beheert blijven staan,
    // en een schaalgebied blijft meethulp (#611).
    const uitkomst = vlakDocument(pdfDocLib, {
      annotaties: teVlakken,
      herstelbaar,
      isTeVlakken: teVlakkenNa(eersteNieuwObject),
    });
    const meethulpen = teVlakken.filter((a) => a.type === 'scaleRegion').length;
    const blijven = uitkomst.zonderUiterlijk + uitkomst.verborgen + uitkomst.overgeslagen + meethulpen;
    if (uitkomst.gebakken === 0) {
      hideLoading();
      showMessage(t('flattenAll.nothingBaked'));
      return { ok: false, reden: 'niets-gebakken', ...uitkomst };
    }
    // De vervangen annotaties en hun appearances niet als ballast meenemen.
    await annulering.wacht(pdfDocLib.flush());
    await annulering.punt();
    ruimOnbereikbaarOp(pdfDocLib);
    const nieuweBytes = new Uint8Array(await annulering.wacht(pdfDocLib.save()));
    if (!state.documents.includes(doc)) return { ok: false, reden: 'geen-document' };
    // Punt zonder terugkeer: het model gaat nu over op de gevlakte bytes.
    annulering.vastleggen();

    // Wat gebakken is, staat nu in de pagina-inhoud; een markering zonder
    // uiterlijk (een notitie) blijft markering. Een vastgezet knipsel stond
    // al in de inhoud (of kwam er bij deze bouw in) en gaat ook uit het model.
    const gebakken = new Set(uitkomst.gebakkenIds);
    const nieuweAnnotaties = teVlakken.filter((a) => !gebakken.has(String(a.id)));
    // De paginadraaiingen van de app staan nu in de bytes (/Rotate).
    const { reloadFromBytes } = await import('./page-manager.js');
    await reloadFromBytes(nieuweBytes, nieuweAnnotaties, {}, pagina, null, doc);
    const { recordPageStructure } = await import('../core/undo-manager.js');
    recordPageStructure(oudeBytes, oudeAnnotaties, oudeRotaties, pagina, nieuweBytes, nieuweAnnotaties, {}, pagina);

    let tekst = t('flattenAll.done', { count: gebakken.size });
    if (blijven > 0) tekst += ' ' + t('flattenAll.kept', { count: blijven });
    meld(tekst);
    return { ok: true, herstelbaar, ...uitkomst };
  } catch (e) {
    if (isOpslagGeannuleerd(e)) {
      meld(t('flattenAll.cancelled'));
      return { ok: false, reden: 'geannuleerd' };
    }
    console.error('[flatten-all] flattening failed:', e);
    showMessage(t('flattenAll.failed', { error: e?.message || String(e) }));
    return { ok: false, reden: 'fout', fout: e?.message || String(e) };
  } finally {
    stopVoortgang();
    hideLoading();
  }
}

/**
 * Alles terughalen: de markeringen van herstelbare vlak-partijen terug.
 * @returns {Promise<{ok:boolean, reden?:'geen-document'|'nooit-gevlakt'|'geen-herstel'|'fout', hersteld?:number}>}
 */
export async function unflattenAllMarkups({ doc = getActiveDocument() } = {}) {
  if (!(await magBewerken(doc))) return { ok: false, reden: 'geen-document' };
  const { showLoading, hideLoading } = await import('../ui/chrome/dialogs.js');
  // Het herladen hieronder markeert elke pagina als geladen: wat dan nog niet
  // in het model stond, zou de volgende save uit het bestand halen.
  if (!(await laadAlleAnnotaties(doc))) {
    showMessage(t('flattenAll.notLoaded'));
    return { ok: false, reden: 'niet-geladen' };
  }
  showLoading(t('unflattenAll.busy'));
  try {
    const oudeBytes = await huidigeBytes(doc);
    if (!oudeBytes) throw new Error('no document bytes');
    const { PDFDocument } = await import('pdf-lib');
    const { ontvlakDocument, ruimOnbereikbaarOp } = await import('./flatten-bytes.js');
    const pdfDocLib = await PDFDocument.load(oudeBytes.slice(), { updateMetadata: false });
    const uitkomst = ontvlakDocument(pdfDocLib);
    if (!uitkomst.snapshot) {
      hideLoading();
      const geenHerstel = uitkomst.gevonden > 0;
      showMessage(t(geenHerstel ? 'unflattenAll.noRecovery' : 'unflattenAll.nothing'));
      return { ok: false, reden: geenHerstel ? 'geen-herstel' : 'nooit-gevlakt', gevonden: uitkomst.gevonden };
    }
    // Een vectorknipsel heeft zijn bronpagina nodig; die staat in het bestand
    // (de saver liet hem staan voor deze herstelkopie), maar na heropenen nog
    // niet in de knipselopslag van de app.
    if (uitkomst.annotaties.some((a) => a.type === 'vectorSnippet')) {
      try {
        const { leesKnipselBronnen } = await import('./loader/vector-snippet-load.js');
        const { bewaar } = await import('../annotations/vector-snippet-store.js');
        await leesKnipselBronnen(pdfDocLib, bewaar);
      } catch (e) {
        console.warn('[flatten-all] snippet sources not read:', e);
      }
    }
    ruimOnbereikbaarOp(pdfDocLib);
    const nieuweBytes = new Uint8Array(await pdfDocLib.save());
    if (!state.documents.includes(doc)) return { ok: false, reden: 'geen-document' };

    const oudeAnnotaties = doc.annotations.map((a) => ({ ...a }));
    const rotaties = { ...(doc.pageRotations || {}) };
    const pagina = doc.currentPage || 1;
    const nieuweAnnotaties = voegTeruggehaaldToe(doc.annotations, uitkomst.annotaties);
    const { reloadFromBytes } = await import('./page-manager.js');
    await reloadFromBytes(nieuweBytes, nieuweAnnotaties, rotaties, pagina, null, doc);
    const { recordPageStructure } = await import('../core/undo-manager.js');
    recordPageStructure(oudeBytes, oudeAnnotaties, rotaties, pagina, nieuweBytes, nieuweAnnotaties, rotaties, pagina);
    meld(t('unflattenAll.done', { count: uitkomst.annotaties.length }));
    return { ok: true, hersteld: uitkomst.annotaties.length, verwijderd: uitkomst.verwijderd, verloren: uitkomst.verloren };
  } catch (e) {
    console.error('[flatten-all] unflattening failed:', e);
    showMessage(t('unflattenAll.failed', { error: e?.message || String(e) }));
    return { ok: false, reden: 'fout', fout: e?.message || String(e) };
  } finally {
    hideLoading();
  }
}
