// Goedkeuringsroutes (#651): de stappen van een aanvraag, los van de app.
//
//   prepare → preview → submit → recordDecision / importReceipt → …
//   cancel, supersede, supersedeChanged (document gewijzigd), recordExpiry
//
// Alleen submit() roept provider.deliver() aan: voorbereiden, voorvertonen,
// beslissingen vastleggen en exporteren verzenden of uploaden niets. Submit
// controleert eerst dat de gebruiker precies de bijlage zag die uitgaat
// (confirmedHash) en dat de gebeurtenissen geldig zijn, en legt ze pas vast
// nadat de provider het concept of pakket heeft overgedragen.
//
// Alles van buiten komt via parameters, zodat dit in Node te testen is:
//   store     : { entries(), find(id), add(entry), put(entry) }  (entry = { record, kept })
//   sources   : { put(hash, bytes), get(hash) }  exacte bytes, op hash
//   providers : createProviders(...) uit providers.js
//   isEnabled : (providerId) => boolean  expliciet ingeschakeld?
//   t         : i18next.t van de namespace dialogs
//   now       : () => ISO-tijd

import {
  createRequest, verifyRequest, appendEvent, recordReceipt, ownerReceipt, matchCopy, findCopyMatches,
  requestRef, refsInText, digest, OPEN_STATES,
} from './model.js';
import { attachmentName, dispatchRecipients } from './providers.js';
import { zipStore } from '../bcf/bcf-zip.js';

const fail = (code) => { throw new Error(code); };
const copy = (value) => JSON.parse(JSON.stringify(value));

export function createApprovalCore({ store, sources, providers, isEnabled = () => true, t = (k) => k, now = () => new Date().toISOString() }) {
  const entry = (id) => store.find(id) || fail('REQUEST_NOT_FOUND');
  const provider = (id) => providers[id] || fail('UNKNOWN_PROVIDER');

  async function exactBytes(hash) {
    const bytes = await sources.get(hash);
    if (!bytes || await digest(bytes) !== hash) fail('OPEN_EXACT_DOCUMENT_VERSION');
    return bytes;
  }

  /**
   * Wat er bij de volgende verzending als bijlage meegaat. Parallel krijgt
   * iedereen de verzonden versie. Opeenvolgend krijgt de volgende ontvanger
   * de laatst teruggekomen kopie die aantoonbaar op de verzonden versie
   * voortbouwt (exact of incrementeel), zodat handtekeningen zich opstapelen.
   */
  function attachmentOf(e) {
    const src = e.record.config.source;
    const name = attachmentName(e.record);
    if (e.record.config.mode === 'sequential') {
      const last = (e.kept || []).filter((k) => k.match === 'exact' || k.match === 'incremental').pop();
      if (last) return { name, hash: last.hash, size: last.size, from: 'copy' };
    }
    return { name, hash: src.hash, size: src.size ?? null, from: 'source' };
  }

  /** Een nieuw concept van de huidige documentversie (`source` = { bytes, name, pages, revision }). */
  async function prepare(input, source) {
    const adapter = input.provider || 'local-file-v1';
    provider(adapter);
    if (!isEnabled(adapter)) fail('CONFIGURE_ADAPTER_FIRST');
    if (store.entries().length >= 100) fail('REQUEST_LIMIT');
    const bytes = source.bytes;
    const record = await createRequest({
      title: input.title,
      mode: input.mode,
      expiresAt: input.expiresAt ?? null,
      message: typeof input.message === 'string' ? input.message : '',
      source: { name: source.name, hash: await digest(bytes), pages: source.pages, revision: input.revision || '', size: bytes.length },
      recipients: (input.recipients || []).map((r) => ({ ...r, role: r.role || 'approve' })),
      fields: (input.fields || []).map((f) => ({ ...f, kind: f.kind || 'review' })),
    }, now(), { version: 2, adapter });
    await sources.put(record.config.source.hash, bytes);
    store.add({ record, kept: [] });
    return record;
  }

  /** Het exacte uitgaande verzoek voor de volgende verzending; verzendt niets. */
  async function preview(id) {
    const e = entry(id), state = await verifyRequest(e.record, now());
    if (!OPEN_STATES.includes(state.status)) fail('REQUEST_CLOSED');
    if (e.record.version === 1 && state.status !== 'draft') fail('ALREADY_RELEASED');
    if (!dispatchRecipients(e.record, state).length) fail('NOTHING_TO_SEND');
    const attachment = attachmentOf(e);
    const outgoing = provider(e.record.adapter).outgoing(e.record, state, { t, attachment });
    return { outgoing, state };
  }

  /** De bytes van de bijlage, voor de paginavoorvertoning. */
  async function attachmentBytes(id) {
    return exactBytes(attachmentOf(entry(id)).hash);
  }

  /**
   * Het enige pad dat iets de app uit brengt. `confirmedHash` is de hash van
   * de bijlage die de gebruiker in de voorvertoning zag.
   */
  async function submit(id, { confirmedHash, actor = 'Local operator' } = {}) {
    const e = entry(id);
    if (!isEnabled(e.record.adapter)) fail('CONFIGURE_ADAPTER_FIRST');
    const { outgoing, state } = await preview(id);
    if (confirmedHash !== outgoing.attachment.hash) fail('CONFIRM_EXACT_VERSION');
    const bytes = await exactBytes(outgoing.attachment.hash);
    const at = now();
    let next = e.record;
    if (state.status === 'draft') next = await appendEvent(next, 'submit', {}, actor, at);
    if (next.version === 2) {
      next = await appendEvent(next, 'dispatch', {
        provider: next.adapter, recipients: outgoing.recipients.map((r) => r.id), attachmentHash: outgoing.attachment.hash,
      }, actor, at);
    }
    await provider(next.adapter).deliver(outgoing, bytes, next);
    store.put({ ...e, record: next });
    return { record: copy(next), state: await verifyRequest(next, at), outgoing };
  }

  /** Teruggekomen bestand: bij welke aanvragen past het (op hash, anders op verwijzing)? */
  async function matchReturned(bytes, name = '') {
    return findCopyMatches(store.entries().map((e) => e.record), bytes, name);
  }

  /**
   * Een gemelde beslissing vastleggen (versie 2), met of zonder teruggekomen
   * kopie. Een kopie die alleen op de verwijzing in de bestandsnaam past,
   * vraagt `confirmReference: true`; een kopie die nergens op past, wordt
   * geweigerd. De kopie zelf wordt bewaard (sources + entry.kept).
   */
  async function recordDecision(id, { recipientId, decision, comment = '', copy: returned = null, confirmReference = false, actor = 'Local operator' }) {
    const e = entry(id);
    if (e.record.version !== 2) fail('USE_RECEIPT_FILE');
    let evidence = { kind: 'reply' }, kept = null;
    if (returned) {
      const name = String(returned.name || 'returned.pdf').slice(-500);
      let m = await matchCopy(e.record, returned.bytes);
      if (!m.match) {
        if (!refsInText(name).includes(requestRef(e.record.id))) fail('COPY_DOES_NOT_MATCH');
        if (confirmReference !== true) fail('CONFIRM_REFERENCE_MATCH');
        m = { ...m, match: 'reference' };
      }
      evidence = { kind: 'copy', copy: { hash: m.hash, size: m.size, match: m.match, name } };
      kept = { hash: m.hash, size: m.size, match: m.match, name, recipientId, decision };
    }
    const at = now();
    const receipt = ownerReceipt(e.record, { recipientId, decision, comment, evidence }, at);
    const next = await recordReceipt(e.record, receipt, at, `${actor} (reported decision)`);
    if (kept) {
      await sources.put(kept.hash, returned.bytes);
      kept.at = at;
    }
    const updated = { ...e, record: next, kept: kept ? [...(e.kept || []), kept] : (e.kept || []) };
    store.put(updated);
    return { record: copy(next), state: await verifyRequest(next, at), kept };
  }

  /** Een ontvangstbewijs (request.json-route van de lokale bestandsoverdracht). */
  async function importReceipt(id, receipt, actor) {
    const e = entry(id);
    const next = await recordReceipt(e.record, receipt, now(), actor);
    store.put({ ...e, record: next });
    return { record: copy(next), state: await verifyRequest(next, now()) };
  }

  async function event(id, kind, payload, actor) {
    const e = entry(id), at = now();
    const next = await appendEvent(e.record, kind, payload, actor, at);
    store.put({ ...e, record: next });
    return { record: copy(next), state: await verifyRequest(next, at) };
  }
  const cancel = (id, actor) => event(id, 'cancel', {}, actor);
  function supersede(id, replacementId, actor) {
    entry(replacementId);
    return event(id, 'supersede', { replacementId }, actor);
  }

  /**
   * Het document is na het voorbereiden gewijzigd en wordt opgeslagen: elke
   * lopende aanvraag (versie 2) gaat over een oudere versie en is vervangen.
   * Geeft de ids die zijn vervangen.
   */
  async function supersedeChanged(actor = 'Local operator') {
    const done = [];
    for (const e of store.entries()) {
      if (e.record.version !== 2) continue;
      let state;
      try { state = await verifyRequest(e.record, now()); } catch { continue; }
      // Alleen een nog lopende aanvraag; afgeronde, afgewezen, verlopen en
      // geannuleerde aanvragen houden hun eigen eindtoestand.
      if (!OPEN_STATES.includes(state.status)) continue;
      await event(e.record.id, 'supersede', { reason: 'document-changed' }, actor);
      done.push(e.record.id);
    }
    return done;
  }

  /** Verlopen aanvragen krijgen een expliciete gebeurtenis in hun geschiedenis. */
  async function recordExpiry(actor = 'Local operator') {
    const done = [];
    for (const e of store.entries()) {
      let state;
      try { state = await verifyRequest(e.record, now()); } catch { continue; }
      if (state.status !== 'expired' || e.record.events.some((x) => x.kind === 'expire')) continue;
      await event(e.record.id, 'expire', {}, actor);
      done.push(e.record.id);
    }
    return done;
  }

  async function list() {
    const out = [];
    for (const e of store.entries()) {
      try {
        out.push({ record: copy(e.record), state: await verifyRequest(e.record, now()), kept: copy(e.kept || []), where: e.where || 'document' });
      } catch {
        out.push({ record: { id: e.record?.id, config: { title: 'Invalid audit' } }, state: { status: 'invalid', integrity: false }, kept: [], where: e.where || 'document' });
      }
    }
    return out;
  }

  /**
   * Overdrachts- en auditpakket: de verzonden PDF (als die er nog is), de
   * bewaarde teruggekomen kopieën, het volledige record en een
   * samenvatting. Zonder login, als gewoon ZIP-bestand.
   */
  async function exportPackage(id) {
    const e = entry(id), state = await verifyRequest(e.record, now());
    const files = [];
    const source = await sources.get(e.record.config.source.hash);
    if (source && await digest(source) === e.record.config.source.hash) files.push({ name: 'document.pdf', data: source });
    for (const [i, k] of (e.kept || []).entries()) {
      const bytes = await sources.get(k.hash);
      if (bytes && await digest(bytes) === k.hash) files.push({ name: `returned/${String(i + 1).padStart(2, '0')}-${k.decision}-${k.hash.slice(0, 12)}.pdf`, data: bytes });
    }
    files.push({ name: 'request.json', data: JSON.stringify(e.record, null, 2) });
    files.push({ name: 'audit-summary.json', data: JSON.stringify({ ...state, kept: e.kept || [] }, null, 2) });
    files.push({ name: 'README.txt', data: t('approvalRouting.packageReadme') });
    return { bytes: zipStore(files), record: copy(e.record), state, complete: !!source };
  }

  return { prepare, preview, attachmentBytes, submit, matchReturned, recordDecision, importReceipt, cancel, supersede, supersedeChanged, recordExpiry, list, exportPackage };
}
