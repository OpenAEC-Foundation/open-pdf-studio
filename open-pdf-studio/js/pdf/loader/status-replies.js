// Review-status replies (issue #308).
//
// Per PDF-spec wordt een review-status opgeslagen als een aparte Text-
// annotatie met /State + /StateModel ("Review" of "Marked"), via /IRT
// (in-reply-to) gekoppeld aan de doel-annotatie. Externe PDF-programma's
// schrijven zo'n status-reply wanneer de gebruiker een commentaar op
// bijv. "Completed" zet. Voorheen importeerde de loader die replies als
// losse sticky notes; deze module herkent ze en zet de status op de
// doel-annotatie zelf.
//
// Bewust GEEN app-imports hier zodat de logica ook standalone (Node-
// tests) draait.

// PDF-datum (D:YYYYMMDDHHmmSS...) of ISO-string → ISO-string (of null).
export function toIsoDate(raw) {
  if (!raw || typeof raw !== 'string') return null;
  try {
    if (raw.startsWith('D:')) {
      const s = raw.substring(2);
      const year = s.substring(0, 4);
      const month = s.substring(4, 6) || '01';
      const day = s.substring(6, 8) || '01';
      const hour = s.substring(8, 10) || '00';
      const min = s.substring(10, 12) || '00';
      const sec = s.substring(12, 14) || '00';
      const d = new Date(`${year}-${month}-${day}T${hour}:${min}:${sec}Z`);
      return isNaN(d.getTime()) ? null : d.toISOString();
    }
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Herken een status-reply in een PDF.js-annotatie.
 *
 * PDF.js parseert /State en /StateModel al voor Text-annotaties
 * (annot.state / annot.stateModel) en /IRT voor alle markup-annotaties
 * (annot.inReplyTo = ref-string zoals "12R", gelijk aan annot.id van de
 * doel-annotatie).
 *
 * @returns {null | {__statusReply: true, targetId, state, stateModel, author, date}}
 */
export function statusReplyFromPdfAnnotation(annot) {
  if (!annot || annot.subtype !== 'Text') return null;
  if (!annot.inReplyTo || !annot.state) return null;
  const state = String(annot.state);
  let stateModel = annot.stateModel ? String(annot.stateModel) : '';
  if (!stateModel) {
    // /StateModel is verplicht bij /State; toch defensief afleiden.
    stateModel = (state === 'Marked' || state === 'Unmarked') ? 'Marked' : 'Review';
  }
  return {
    __statusReply: true,
    targetId: annot.inReplyTo,
    state,
    stateModel,
    author: (annot.titleObj && annot.titleObj.str) || annot.title || '',
    date: toIsoDate(annot.modificationDate) || toIsoDate(annot.creationDate),
  };
}

/**
 * Pas verzamelde status-replies toe op hun doel-annotaties.
 *
 * - Model "Review": zet `status` (lowercase: accepted/rejected/cancelled/
 *   completed/...) plus `statusBy`/`statusAt` op het doel.
 * - Model "Marked": zet het bestaande `marked`-veld.
 *
 * Replies worden op datum (oplopend) toegepast zodat bij meerdere
 * status-wijzigingen de laatste wint; zonder datum telt documentvolgorde.
 * Zijn er meerdere Review-replies, dan komt hun verloop als
 * `statusHistory` ([{status, by, at}], oud naar nieuw) op het doel (#629,
 * review/status-history.js).
 *
 * @param {Array} pending  markers uit statusReplyFromPdfAnnotation()
 * @param {Map<string, object>} byPdfId  PDF.js-annotatie-id → app-annotatie
 * @returns {number} aantal toegepaste statussen
 */
export function applyStatusReplies(pending, byPdfId) {
  if (!pending || pending.length === 0) return 0;
  const sorted = pending
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const da = a.p.date ? Date.parse(a.p.date) : NaN;
      const db = b.p.date ? Date.parse(b.p.date) : NaN;
      if (!isNaN(da) && !isNaN(db) && da !== db) return da - db;
      return a.i - b.i; // stabiel: documentvolgorde
    })
    .map(x => x.p);

  let applied = 0;
  const verloop = new Map(); // doel -> [{status, by, at}]
  for (const st of sorted) {
    const target = byPdfId.get(st.targetId);
    if (!target) continue;
    if (st.stateModel === 'Marked') {
      target.marked = st.state === 'Marked';
    } else {
      const s = st.state.toLowerCase();
      if (s === 'none') {
        delete target.status;
      } else {
        target.status = s;
      }
      if (st.author) target.statusBy = st.author;
      if (st.date) target.statusAt = st.date;
      if (!verloop.has(target)) verloop.set(target, []);
      verloop.get(target).push({ status: s || 'none', by: st.author || '', at: st.date || null });
    }
    applied++;
  }
  for (const [target, stappen] of verloop) {
    if (stappen.length > 1) target.statusHistory = stappen;
  }
  return applied;
}
