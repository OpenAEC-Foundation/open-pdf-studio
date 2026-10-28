// De pdf.js-annotaties van één pagina omzetten naar het model, inclusief de
// koppelingen tussen annotaties onderling.
//
// - Aanhaallijnen van een tekstvak (PolyLine met /IRT en eigen sleutel) gaan
//   als leader aan hun tekstvak, niet als losse annotatie.
// - Review- en markeerstatus (Text + /IRT + /State, #308) wordt de status of
//   `marked` van de doel-annotatie.
// - Antwoorden die de app zelf schreef (Text + /IRT + /OPS_Subtype reply)
//   worden weer `replies` van hun doel-annotatie (#619).
// - Elke andere /IRT-koppeling blijft in het model als `inReplyTo` (id van de
//   doel-annotatie) en `replyType` ('reply' of 'group'), zodat de saver hem
//   terugschrijft (#619). Een vervanging (invoegteken en doorhaling, #508)
//   koppelt resolveGroupLinks daarna op haar eigen manier.
// - Elk model krijgt `pdfBron`: waar het in het bestand staat en hoe het er
//   bij het laden uitzag, met de statussen, antwoorden en aanhaallijnen die
//   erin opgingen. Zo laat de saver een annotatie die niet veranderde precies
//   zoals ze was (#629, saver/bron-behoud.js).
//
// Geen DOM: draait ook in de opslaan-en-heropenen-tests.

import { convertPdfAnnotation } from './annotation-converter.js';
import { statusReplyFromPdfAnnotation, applyStatusReplies } from './status-replies.js';
import { resolveGroupLinks } from './correction-load.js';
import { koppelAntwoorden, eigenAntwoordUitAnnot } from './annotatie-algemeen.js';
import { extraVoorAnnotatie } from './extra-sleutel.js';
import { maakBron } from '../saver/bron-vingerafdruk.js';

/**
 * @returns {Promise<object[]>} de omgezette annotaties, in paginavolgorde
 */
export async function zetPaginaAnnotatiesOm(annots, pageNum, viewport, stampImageMap, annotColorMap) {
  const textboxByRect = new Map();
  const byPdfId = new Map();
  const pendingLeaders = [];
  const pendingStatuses = [];
  const antwoorden = []; // eigen antwoorden (replies), zie koppelAntwoorden
  const koppelingen = []; // overige /IRT-koppelingen
  const groepen = []; // /RT /Group-kinderen, zie resolveGroupLinks
  const nieuw = [];
  const pdfIdVan = new Map(); // model -> pdf.js-id, voor pdfBron
  const geenBron = new Set(); // modellen die niet één op één uit een woordenboek komen
  const statusIds = []; // [doel-id, pdf.js-id] per statusantwoord
  const leiderIds = new Map(); // aanhaallijn -> pdf.js-id
  for (const annot of annots) {
    const statusReply = statusReplyFromPdfAnnotation(annot);
    if (statusReply) {
      pendingStatuses.push(statusReply);
      if (annot.id) statusIds.push([statusReply.targetId, annot.id]);
      continue;
    }
    const antwoord = eigenAntwoordUitAnnot(annot, extraVoorAnnotatie(annotColorMap, annot));
    if (antwoord) {
      antwoorden.push({ ...antwoord, annot });
      continue;
    }
    const converted = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
    if (!converted) continue;
    if (converted.__textboxLeader) {
      pendingLeaders.push(converted);
      if (annot.id) leiderIds.set(converted, annot.id);
      continue;
    }
    // Een stempel met /OPS_Rotation van een oudere versie van de app: de lader
    // leest die draaiing bewust anders, en de saver schrijft hem zoals de app
    // hem toont (stempel-draaiing). Die herschrijft de saver dus wel.
    const oudeStempelDraaiing = converted.type === 'stamp'
      && extraVoorAnnotatie(annotColorMap, annot)?.rotation !== undefined;
    if (annot.id && !oudeStempelDraaiing) pdfIdVan.set(converted, annot.id);
    if (converted.type === 'textbox' && converted._pdfRectKey) {
      textboxByRect.set(converted._pdfRectKey, converted);
    }
    if (annot.id) byPdfId.set(annot.id, converted);
    if (annot.inReplyTo) {
      koppelingen.push({ converted, inReplyTo: annot.inReplyTo, replyType: annot.replyType });
    }
    if (annot.replyType === 'Group' && annot.inReplyTo) {
      groepen.push({ converted, inReplyTo: annot.inReplyTo, replyType: annot.replyType });
    }
    nieuw.push(converted);
    // Sommige converters leveren EXTRA annotaties naast de hoofdannotatie
    // (bv. een legacy meerpunts-betonbalk die in losse tweepunts-balken
    // gesplitst wordt). Die worden hier mee-gepusht.
    if (Array.isArray(converted.__extraAnnotations)) {
      geenBron.add(converted);
      for (const extra of converted.__extraAnnotations) { nieuw.push(extra); geenBron.add(extra); }
      delete converted.__extraAnnotations;
    }
  }
  const mee = new Map(); // model -> { status, antwoorden, leiders } (pdf.js-id's)
  const meeVan = (model, soort) => {
    if (!mee.has(model)) mee.set(model, {});
    const m = mee.get(model);
    if (!m[soort]) m[soort] = [];
    return m[soort];
  };
  for (const pl of pendingLeaders) {
    const parent = textboxByRect.get(pl.irtRectKey);
    if (parent) {
      if (!Array.isArray(parent.leaders)) parent.leaders = [];
      parent.leaders.push(pl.leader);
      if (leiderIds.has(pl)) meeVan(parent, 'leiders').push(leiderIds.get(pl));
      else geenBron.add(parent);
    }
  }
  for (const tb of textboxByRect.values()) delete tb._pdfRectKey;
  applyStatusReplies(pendingStatuses, byPdfId);
  for (const [doelId, id] of statusIds) {
    const doel = byPdfId.get(doelId);
    if (doel) meeVan(doel, 'status').push(id);
  }
  for (const a of antwoorden) {
    const doel = byPdfId.get(a.targetId);
    if (doel && a.annot?.id) meeVan(doel, 'antwoorden').push(a.annot.id);
  }
  // Een antwoord zonder doel op deze pagina blijft een gewone notitie.
  for (const { annot } of koppelAntwoorden(antwoorden, koppelingen, byPdfId)) {
    const notitie = await convertPdfAnnotation(annot, pageNum, viewport, stampImageMap, annotColorMap);
    if (notitie) {
      nieuw.push(notitie);
      if (annot.id) pdfIdVan.set(notitie, annot.id);
    }
  }
  // Vervangingen (#508): invoegteken + doorhaling, in beide richtingen. Na
  // koppelAntwoorden: deze koppeling wint.
  resolveGroupLinks(groepen, byPdfId);
  // Waar elk model vandaan komt, als laatste: het model zoals het nu is.
  const dfps = annotColorMap?.bronnen;
  if (dfps) {
    for (const model of nieuw) {
      if (geenBron.has(model) || !pdfIdVan.has(model)) continue;
      const bron = maakBron(model, pdfIdVan.get(model), dfps, mee.get(model));
      if (bron) model.pdfBron = bron;
    }
  }
  return nieuw;
}
