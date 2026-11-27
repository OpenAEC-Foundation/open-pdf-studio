// Eigenschappen die elke annotatiesoort heeft, bij het laden (#619): naam
// (/NM), onderwerp (/Subj), alternatieve tekst, IFC-categorie, antwoorden en
// koppelingen naar een andere annotatie (/IRT + /RT).
//
// De saver schrijft ze in saver/annotatie-algemeen.js. Puur: geen DOM, geen
// app-state.

import { zoneDefinition } from '../../annotations/spatial-zones.js';
import { onderwerpPlek } from './annotatie-opmerking.js';
import { toIsoDate } from './status-replies.js';
import { vormVingerafdruk } from '../saver/ruwe-sleutels.js';

/**
 * De gedeelde velden voor het model, uit de gegevens die color-extraction.js
 * uit het woordenboek leest. Velden die de tak van de soort al gezet heeft
 * (een correctie zet zelf nm en pdfSubject) blijven staan.
 * @param {object} extra  uit extractAnnotationColors
 * @param {object} model  de omgezette annotatie
 * @returns {object} de velden om aan het model toe te voegen
 */
export function algemeneEigenschappen(extra, model) {
  const e = extra || {};
  const m = model || {};
  const uit = {};
  if (m.type === 'callout' && Number.isInteger(e.cloudVertex)) uit.cloudVertex = e.cloudVertex;
  const zone = zoneDefinition(e.spatialZone);
  if (zone) uit.spatialZone = zone;
  if (typeof e.locationOverride === 'string') uit.locationOverride = e.locationOverride;
  if (e.nm && m.nm === undefined) uit.nm = e.nm;
  if (typeof e.subj === 'string') {
    const plek = onderwerpPlek(m.type);
    if (plek === 'subj' && !m.subject) uit.subject = e.subj;
    else if (plek === 'contents' && m.pdfSubject === undefined) uit.pdfSubject = e.subj;
  }
  if (e.opsAltText && m.altText === undefined) uit.altText = e.opsAltText;
  if (e.opsIfcCategory && m.ifcCategory === undefined) uit.ifcCategory = e.opsIfcCategory;
  // Wat het model niet kent, ruw voor de saver (#621, saver/ruwe-sleutels.js).
  // Met de vingerafdruk van de vorm zoals geladen: verandert de gebruiker de
  // vorm, dan gaan de vormsleutels niet meer mee.
  if (e.pdfRaw && m.pdfRaw === undefined) uit.pdfRaw = { ...e.pdfRaw, vorm: vormVingerafdruk(m) };
  return uit;
}

/**
 * Een antwoord dat de app zelf schreef (saver/annotatie-algemeen.js): een
 * /Text met /IRT, zonder /State, met /OPS_Subtype reply. Antwoorden van een
 * ander programma blijven gewone notities (met hun koppeling), zodat zulke
 * bestanden laden zoals voorheen.
 * @returns {null | { targetId: string, reply: {id,author,text,createdAt} }}
 */
export function eigenAntwoordUitAnnot(annot, extra) {
  if (!annot || annot.subtype !== 'Text' || !annot.inReplyTo || annot.state) return null;
  if (extra?.opsSubtype !== 'reply') return null;
  const createdAt = toIsoDate(annot.creationDate) || toIsoDate(annot.modificationDate) || new Date().toISOString();
  return {
    targetId: annot.inReplyTo,
    reply: {
      id: extra.nm || (Date.now().toString(36) + Math.random().toString(36).slice(2, 7)),
      author: (annot.titleObj && annot.titleObj.str) || annot.title || 'User',
      text: (annot.contentsObj && annot.contentsObj.str) || annot.contents || '',
      createdAt,
    },
  };
}

// Proefleescorrecties koppelt resolveGroupLinks (correction-load.js).
const CORRECTIE_SOORTEN = new Set(['caret', 'textStrikethrough']);

/**
 * Antwoorden aan hun annotatie hangen en de overige /IRT-koppelingen in het
 * model zetten.
 * - `antwoorden`: uit eigenAntwoordUitAnnot, in bestandsvolgorde. Een
 *   antwoord zonder doel op deze pagina vervalt niet stil: het komt terug in
 *   de uitkomst en annotaties-omzetten.js maakt er een gewone notitie van.
 * - `koppelingen`: { converted, inReplyTo, replyType } van pdf.js. Het model
 *   krijgt inReplyTo = id van de doel-annotatie en replyType 'group' bij
 *   /RT /Group, anders 'reply'.
 * @param {Map<string, object>} byPdfId  pdf.js-id ('16R') -> omgezette annotatie
 * @returns {object[]} antwoorden zonder doel
 */
export function koppelAntwoorden(antwoorden, koppelingen, byPdfId) {
  const zonderDoel = [];
  for (const a of antwoorden || []) {
    const doel = byPdfId?.get(a?.targetId);
    if (!doel) { zonderDoel.push(a); continue; }
    if (!Array.isArray(doel.replies)) doel.replies = [];
    doel.replies.push(a.reply);
  }
  for (const k of koppelingen || []) {
    const { converted, inReplyTo, replyType } = k || {};
    if (!converted || CORRECTIE_SOORTEN.has(converted.type)) continue;
    const doel = byPdfId?.get(inReplyTo);
    if (!doel || doel === converted) continue;
    converted.inReplyTo = doel.id;
    converted.replyType = replyType === 'Group' ? 'group' : 'reply';
  }
  return zonderDoel;
}
