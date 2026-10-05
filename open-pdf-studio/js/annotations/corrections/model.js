// Model van proefleescorrecties (#508).
//
// - Invoegen: een 'caret' met de ingevoegde tekst.
// - Schrappen: een 'textStrikethrough' met intent 'StrikeOutTextEdit'.
// - Vervangen: een 'caret' met intent 'Replace' (de ouder) plus een
//   doorhaling met inReplyTo = id van het invoegteken en replyType 'group'.
//   Beide dragen hetzelfde groupId.
//
// De soort volgt alleen uit type, intent, inReplyTo en replyType, nooit uit
// /Subj: die tekst verschilt per programma en per taal.
//
// Puur: geen DOM, geen app-imports.

/** Standaardkleur per soort. */
export const CORRECTION_COLORS = Object.freeze({
  insert: '#0066FF',
  delete: '#FF0000',
  replace: '#9900CC',
});

const TEKST_VERANKERD = new Set([
  'textHighlight', 'textStrikethrough', 'textUnderline', 'textSquiggly', 'caret',
]);

/** Annotaties die aan tekst vastzitten: niet slepen, niet verschuiven. */
export function isTextAnchored(ann) {
  return !!ann && TEKST_VERANKERD.has(ann.type);
}

/** Een doorhaling die als tekstcorrectie bedoeld is (/IT /StrikeOutTextEdit). */
export function isTextEditStrike(ann) {
  return !!ann && ann.type === 'textStrikethrough' && ann.intent === 'StrikeOutTextEdit';
}

const isGroepsantwoord = (ann) => !!ann && ann.inReplyTo != null
  && String(ann.replyType || '').toLowerCase() === 'group';

function alsMap(byId) {
  if (byId instanceof Map) return byId;
  if (Array.isArray(byId)) return new Map(byId.filter(Boolean).map((a) => [a.id, a]));
  return null;
}

/**
 * Soort correctie: 'insert', 'replace', 'replaceChild', 'delete' of null.
 * Zonder `byId` telt een doorhaling met een groepskoppeling als kind; met
 * `byId` alleen als de ouder echt een invoegteken is (anders toont de app de
 * overgebleven helft als haar eigen soort).
 * @param {object} ann
 * @param {Map<string, object>|object[]} [byId]
 */
export function correctionKind(ann, byId) {
  if (!ann) return null;
  if (ann.type === 'caret') return ann.intent === 'Replace' ? 'replace' : 'insert';
  if (ann.type === 'textStrikethrough') {
    if (isGroepsantwoord(ann)) {
      const map = alsMap(byId);
      if (!map || map.get(ann.inReplyTo)?.type === 'caret') return 'replaceChild';
    }
    if (ann.intent === 'StrikeOutTextEdit') return 'delete';
  }
  return null;
}

/**
 * De annotaties die samen één correctie vormen, ouder eerst. Op groupId,
 * anders op het inReplyTo-paar. Een losse annotatie geeft [ann].
 */
export function groupMembers(annotations, ann) {
  if (!ann) return [];
  const lijst = (annotations || []).filter(Boolean);
  if (ann.groupId) {
    const leden = lijst.filter((a) => a.groupId === ann.groupId);
    if (!leden.includes(ann)) leden.push(ann);
    return leden.sort((a, b) => Number(isGroepsantwoord(a)) - Number(isGroepsantwoord(b)));
  }
  const ouder = isGroepsantwoord(ann) ? lijst.find((a) => a.id === ann.inReplyTo) : null;
  const kop = ouder || ann;
  const kinderen = lijst.filter((a) => isGroepsantwoord(a) && a.inReplyTo === kop.id);
  if (ouder && !kinderen.includes(ann)) kinderen.push(ann);
  return [kop, ...kinderen];
}

/**
 * Koppelplan voor één pagina bij het opslaan.
 * - Een doorhaling wordt alleen als kind geschreven als het invoegteken uit
 *   haar inReplyTo op dezelfde pagina geschreven wordt.
 * - Een invoegteken met intent 'Replace' zonder kind verliest die intent en
 *   wordt een gewone invoeging.
 * @param {object[]} pageAnns
 * @returns {{ links: Array<{childId: string, parentId: string}>, stripReplaceIntent: Set<string> }}
 */
export function linkPlanForSave(pageAnns) {
  const lijst = (pageAnns || []).filter(Boolean);
  const karets = new Map(lijst.filter((a) => a.type === 'caret').map((a) => [a.id, a]));
  const links = [];
  const metKind = new Set();
  for (const a of lijst) {
    if (a.type !== 'textStrikethrough' || !isGroepsantwoord(a) || !karets.has(a.inReplyTo)) continue;
    links.push({ childId: a.id, parentId: a.inReplyTo });
    metKind.add(a.inReplyTo);
  }
  const stripReplaceIntent = new Set();
  for (const k of karets.values()) {
    if (k.intent === 'Replace' && !metKind.has(k.id)) stripReplaceIntent.add(k.id);
  }
  return { links, stripReplaceIntent };
}

/**
 * Kleur waarmee een correctie opgeslagen wordt. Een gekoppeld kind krijgt de
 * kleur van zijn invoegteken: lezers nemen /C van de groepsleider over, dus
 * de appearance moet die kleur ook hebben. Zonder kleur de standaard per soort.
 * @param {object} ann
 * @param {object[]} pageAnns
 * @param {{ links: Array<{childId: string, parentId: string}> }} plan  uit linkPlanForSave
 */
export function saveColor(ann, pageAnns, plan) {
  const link = plan?.links?.find((l) => l.childId === ann?.id);
  const ouder = link ? (pageAnns || []).find((a) => a && a.id === link.parentId) : null;
  const bron = ouder || ann;
  if (bron?.color) return bron.color;
  if (ouder) return CORRECTION_COLORS.replace;
  const soort = correctionKind(bron, pageAnns);
  return CORRECTION_COLORS[soort === 'replaceChild' ? 'replace' : soort] || '#000000';
}

function kindVan(ouder, map) {
  if (!ouder || !map) return null;
  for (const a of map.values()) {
    if (a && a.type === 'textStrikethrough' && isGroepsantwoord(a) && a.inReplyTo === ouder.id) return a;
  }
  return null;
}

/** Vertaalsleutel (types.*) voor de lijst: 'replaceText', 'caret', 'crossOut' of null. */
export function displayKey(ann, byId) {
  switch (correctionKind(ann, byId)) {
    case 'replace':
    case 'replaceChild': return 'replaceText';
    case 'insert': return 'caret';
    case 'delete': return 'crossOut';
    default: return null;
  }
}

/** Korte voorvertoning voor de lijst: 'teh -> the', '+ the' of '- teh'. */
export function listPreview(ann, byId) {
  const map = alsMap(byId);
  switch (correctionKind(ann, byId)) {
    case 'replace': {
      const kind = kindVan(ann, map);
      return `${kind?.markedText ?? ''} -> ${ann.text ?? ''}`;
    }
    case 'replaceChild': {
      const ouder = map?.get(ann.inReplyTo);
      return ouder ? listPreview(ouder, map) : `${ann.markedText ?? ''} -> `;
    }
    case 'insert': return `+ ${ann.text ?? ''}`;
    case 'delete': return `- ${ann.markedText ?? ''}`;
    default: return '';
  }
}

/** De doorhaling van een vervanging: staat in de lijst onder haar invoegteken. */
export function isFoldedChild(ann, byId) {
  return correctionKind(ann, byId) === 'replaceChild';
}

/** De vervanging waar `ann` bij hoort, ouder eerst; anders null. */
function vervangingVan(ann, map) {
  const soort = correctionKind(ann, map);
  let ouder = null;
  if (soort === 'replace') ouder = ann;
  else if (soort === 'replaceChild') ouder = map.get(ann.inReplyTo) || null;
  if (!ouder) return null;
  const leden = [ouder];
  for (const a of map.values()) {
    if (a && a.type === 'textStrikethrough' && isGroepsantwoord(a) && a.inReplyTo === ouder.id) leden.push(a);
  }
  return leden;
}

/**
 * De selectie plus de andere helft van elke vervanging erin: een vervanging
 * wordt als één geheel verwijderd, geknipt en ongedaan gemaakt. De selectie
 * blijft vooraan; alleen de echte partners komen erbij (niet de rest van een
 * verzameling met hetzelfde groupId).
 * @param {object[]} annotations  alle annotaties van het document
 * @param {object[]} selection
 */
export function expandCorrectionGroups(annotations, selection) {
  const map = alsMap(annotations || []) || new Map();
  const uit = [];
  const gezien = new Set();
  const voegToe = (a) => { if (a && !gezien.has(a)) { gezien.add(a); uit.push(a); } };
  for (const a of selection || []) voegToe(a);
  for (const a of selection || []) {
    for (const lid of vervangingVan(a, map) || []) voegToe(lid);
  }
  return uit;
}

/**
 * Het invoegteken als `members` precies één vervanging is (het invoegteken
 * plus zijn doorhaling), anders null. Dan toont het paneel het invoegteken
 * in plaats van een meervoudige selectie.
 * @param {object[]} members
 * @param {object[]|Map<string, object>} annotations
 */
export function replaceParentOf(members, annotations) {
  const lijst = (members || []).filter(Boolean);
  const map = alsMap(annotations || []) || new Map();
  const ouders = lijst.filter((a) => correctionKind(a, map) === 'replace');
  if (ouders.length !== 1) return null;
  const ouder = ouders[0];
  const klopt = lijst.every((a) => a === ouder
    || (correctionKind(a, map) === 'replaceChild' && a.inReplyTo === ouder.id));
  return klopt ? ouder : null;
}

/**
 * De lijst zonder de doorhalingen die onder hun invoegteken gevouwen worden.
 * Staat het invoegteken zelf niet in de lijst (bijvoorbeeld bij een filter op
 * soort), dan blijft de doorhaling staan.
 * @param {object[]} list
 * @param {object[]|Map<string, object>} annotations
 */
export function withoutFoldedChildren(list, annotations) {
  const map = alsMap(annotations || []) || new Map();
  const inLijst = new Set((list || []).map((a) => a && a.id));
  return (list || []).filter((a) => !(isFoldedChild(a, map) && inLijst.has(a.inReplyTo)));
}

/**
 * Kopieën na plakken, plakken op plaats of dupliceren. De klonen hebben al
 * een nieuw id; `clones[i]` is de kopie van `sources[i]`.
 * - Een koppeling binnen de geplakte reeks wijst naar de nieuwe kopie; een
 *   koppeling naar iets daarbuiten vervalt, de kopie wordt dan een gewone
 *   schrapping.
 * - Het eigen groupId van een vervanging (het id van haar invoegteken) volgt
 *   de kopie; het groupId van een verzameling blijft, zoals bij elke andere
 *   geplakte annotatie.
 * - Een invoegteken met intent 'Replace' zonder geplakte doorhaling wordt een
 *   gewone invoeging.
 * - Elke kopie verliest nm: /NM moet per pagina uniek zijn, de saver schrijft
 *   dan een eigen naam.
 * @param {object[]} sources
 * @param {object[]} clones  worden aangepast
 * @returns {object[]} clones
 */
export function relinkPastedCorrections(sources, clones) {
  const lijst = clones || [];
  const nieuw = new Map();
  (sources || []).forEach((s, i) => { if (s && lijst[i]) nieuw.set(s.id, lijst[i].id); });
  lijst.forEach((c, i) => {
    if (!c) return;
    delete c.nm;
    const bron = sources?.[i];
    let eigenGroep = null;
    if (bron?.type === 'caret') eigenGroep = bron.id;
    else if (bron?.type === 'textStrikethrough' && isGroepsantwoord(bron)) eigenGroep = bron.inReplyTo;
    if (c.inReplyTo != null) {
      if (nieuw.has(c.inReplyTo)) c.inReplyTo = nieuw.get(c.inReplyTo);
      else { delete c.inReplyTo; delete c.replyType; }
    }
    if (eigenGroep != null && c.groupId === eigenGroep) {
      if (nieuw.has(eigenGroep)) c.groupId = nieuw.get(eigenGroep);
      else delete c.groupId;
    }
  });
  for (const c of lijst) {
    if (c?.type !== 'caret' || c.intent !== 'Replace') continue;
    if (lijst.some((d) => d && d.type === 'textStrikethrough' && isGroepsantwoord(d) && d.inReplyTo === c.id)) continue;
    delete c.intent;
    if (c.groupId === c.id) delete c.groupId;
  }
  return lijst;
}
