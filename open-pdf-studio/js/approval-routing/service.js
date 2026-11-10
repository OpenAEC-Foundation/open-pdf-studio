// Goedkeuringsroutes (#651): de koppeling van core.js aan de app.
//
//  - Aanvragen staan bij het document (doc.goedkeuringen, in de PDF als
//    OPS_ApprovalRequests via document-store.js). Oudere aanvragen uit de
//    voorkeuren (versie 1) blijven zichtbaar en bruikbaar ("app").
//  - De exacte verzonden bytes en teruggekomen kopieën staan op hash in het
//    geheugen en, op de desktop, in de app-datamap (approval-sources/).
//  - Providers worden expliciet ingeschakeld in de voorkeuren
//    (approvalRouting.providers); er is geen standaard-provider die vanzelf
//    iets verstuurt.
//  - Een teruggekomen kopie wordt als bijlage in het document bewaard.
//  - Bij opslaan: zie save-hook.js.

import { state, getActiveDocument } from '../core/state.js';
import { savePreferences } from '../core/preferences.js';
import { isTauri, readBinaryFile, writeBinaryFileNew, fileExists, getAppDataDir, downloadBestand, saveFileDialog } from '../core/platform.js';
import { documentRevisie } from '../core/undo-manager.js';
import { markDocumentModified } from '../ui/chrome/tabs.js';
import i18next from '../i18n/config.js';
import { createApprovalCore } from './core.js';
import { createProviders } from './providers.js';
import { verifyRequest, makeReceipt, digest, requestRef, PROVIDERS } from './model.js';
import { contentChanged, markApprovalModified } from './document-store.js';
import { zipStore } from '../bcf/bcf-zip.js';
import { actorFor, checkAutomationRequest } from './origin.js';

const t = (key, options) => i18next.t(key, { ns: 'dialogs', ...options });
let pending = Promise.resolve();
const prefs = () => state.preferences.approvalRouting || { enabled: false, requests: [] };
const persist = (value) => { state.preferences.approvalRouting = value; savePreferences(); };
const copy = (value) => JSON.parse(JSON.stringify(value));
/** Expliciet ingeschakeld? `enabled` is de oude schakelaar van local-file-v1. */
const isEnabled = (id) => prefs().providers?.[id] === true || (id === 'local-file-v1' && prefs().enabled === true);

// ── Opslag van aanvragen ────────────────────────────────────────────────────
// Altijd een nieuwe lijst toewijzen en daarna niets meer muteren: het
// document bewaart bij toewijzen een kopie.
function storeFor(doc, { quiet = false } = {}) {
  const docEntries = () => (doc && Array.isArray(doc.goedkeuringen) ? doc.goedkeuringen : []);
  const legacy = () => (prefs().requests || []).map((e) => ({ record: e.record, kept: [], where: 'app', sourcePath: e.sourcePath }));
  const setDoc = (list) => {
    if (!doc) throw new Error('OPEN_SAVED_SOURCE');
    doc.goedkeuringen = list;
    if (!quiet) markApprovalModified(doc, markDocumentModified);
  };
  const entries = () => [...docEntries().map((e) => ({ record: e.record, kept: e.kept || [], where: 'document' })), ...legacy()];
  return {
    entries,
    find: (id) => entries().find((e) => e.record?.id === id),
    add: (e) => setDoc([...docEntries().map(copy), { record: copy(e.record), kept: copy(e.kept || []) }]),
    put: (e) => {
      if (e.where === 'app') {
        persist({ ...prefs(), requests: prefs().requests.map((x) => (x.record.id === e.record.id ? { ...x, record: copy(e.record) } : x)) });
      } else {
        setDoc(docEntries().map((x) => (x.record.id === e.record.id ? { record: copy(e.record), kept: copy(e.kept || []) } : copy(x))));
      }
    },
  };
}

// ── Exacte bytes op hash ────────────────────────────────────────────────────
const memory = new Map();
async function sourceDir() {
  if (!isTauri()) return null;
  try {
    const dir = `${String(await getAppDataDir()).replace(/[\\/]+$/, '')}/approval-sources`;
    try { await window.__TAURI__?.fs?.mkdir?.(dir, { recursive: true }); } catch { /* bestaat al */ }
    return dir;
  } catch { return null; }
}
const sources = {
  async put(hash, bytes) {
    memory.delete(hash);
    memory.set(hash, bytes.slice());
    while (memory.size > 6) memory.delete(memory.keys().next().value);
    const dir = await sourceDir();
    if (!dir) return;
    const path = `${dir}/${hash}.pdf`;
    try { if (!(await fileExists(path))) await writeBinaryFileNew(path, bytes); } catch (e) { console.warn('[approval] exact copy not kept on disk:', e?.message || e); }
  },
  async get(hash) {
    const found = memory.get(hash);
    if (found) return found.slice();
    const dir = await sourceDir();
    if (dir) {
      try {
        const bytes = new Uint8Array(await readBinaryFile(`${dir}/${hash}.pdf`));
        if (await digest(bytes) === hash) return bytes;
      } catch { /* niet bewaard */ }
    }
    // Een geopend document of een oud bronpad met precies deze inhoud.
    const { getCachedPdfBytes } = await import('../pdf/loader.js');
    for (const doc of state.documents) {
      if (!doc.pdfDoc) continue;
      try {
        const bytes = getCachedPdfBytes(doc.saveTargetPath || doc.filePath) || await doc.pdfDoc.getData();
        if (await digest(bytes) === hash) return bytes.slice();
      } catch { /* volgende */ }
    }
    if (isTauri()) {
      for (const e of prefs().requests || []) {
        if (!e.sourcePath || e.record?.config?.source?.hash !== hash) continue;
        try {
          const bytes = new Uint8Array(await readBinaryFile(e.sourcePath));
          if (await digest(bytes) === hash) return bytes;
        } catch { /* weg */ }
      }
    }
    return null;
  },
};

// ── Providers ───────────────────────────────────────────────────────────────
function packageBytes(record, state, bytes) {
  return zipStore([
    { name: 'document.pdf', data: bytes },
    { name: 'request.json', data: JSON.stringify(record, null, 2) },
    { name: 'audit-summary.json', data: JSON.stringify(state, null, 2) },
    { name: 'README.txt', data: t('approvalRouting.packageReadme') },
  ]);
}
async function saveOrDownload(name, bytes) {
  if (!isTauri()) { downloadBestand(name, bytes); return name; }
  const path = await saveFileDialog(name, [{ name: 'ZIP', extensions: ['zip'] }]);
  if (!path) throw new Error('CANCELLED');
  await writeBinaryFileNew(path, bytes);
  return path;
}
function providersFor(origin) {
  return createProviders({
    async sendMail({ to, subject, body, name, bytes }) {
      const { verzendBijlagePerMail } = await import('../pdf/delen.js');
      return verzendBijlagePerMail({ naam: name, bytes, onderwerp: subject, aan: to, tekst: body });
    },
    async deliverPackage(record, bytes, outgoing) {
      // Over MCP of een extensie schrijft 'export' het pakket naar een gekozen
      // pad; vrijgeven zelf opent dan geen venster.
      if (origin) return null;
      return saveOrDownload(outgoing.packageName, packageBytes(record, await verifyRequest(record), bytes));
    },
  });
}
const coreFor = (doc, { origin, quiet } = {}) => createApprovalCore({ store: storeFor(doc, { quiet }), sources, providers: providersFor(origin), isEnabled, t });

// ── Teruggekomen kopie als bijlage ──────────────────────────────────────────
async function keepAsAttachment(doc, record, kept, bytes) {
  const { wijzigingenVan, metToegevoegd } = await import('../pdf/bijlagen.js');
  const recipient = record.config.recipients.find((r) => r.id === kept.recipientId);
  const base = record.config.source.name.replace(/\.pdf$/i, '');
  const naam = `${base} - ${requestRef(record.id)} - ${recipient?.name || 'recipient'} (${kept.decision}).pdf`.replace(/[\\/:*?"<>|]/g, '_');
  const nu = new Date().toISOString();
  doc.bijlagenWijzigingen = metToegevoegd(wijzigingenVan(doc), {
    naam, bytes, mime: 'application/pdf', aangemaakt: nu, gewijzigd: nu,
    beschrijving: t('approvalRouting.keptDescription', { ref: requestRef(record.id), hash: kept.hash }),
  });
  markApprovalModified(doc, markDocumentModified);
  return naam;
}

/** Bevat de PDF al opgeslagen goedkeuringsgegevens (van eerdere aanvragen)? */
function containsApprovalData(bytes) {
  const pattern = new TextEncoder().encode('/OPS_ApprovalRequests');
  outer: for (let i = 0; i <= bytes.length - pattern.length; i++) {
    for (let j = 0; j < pattern.length; j++) if (bytes[i + j] !== pattern[j]) continue outer;
    return true;
  }
  return false;
}

// ── Acties ──────────────────────────────────────────────────────────────────
export async function approvalState(doc = getActiveDocument()) {
  return { enabled: prefs().enabled === true, providers: Object.fromEntries(PROVIDERS.map((p) => [p, isEnabled(p)])), requests: await coreFor(doc).list() };
}

async function draft(request, origin) {
  const doc = getActiveDocument();
  if (!doc?.pdfDoc || contentChanged(doc) || Object.values(doc.pageRotations || {}).some(Boolean)) throw new Error('OPEN_SAVED_SOURCE');
  const pdf = doc.pdfDoc, revision = documentRevisie(doc), path = doc.saveTargetPath || doc.filePath;
  const { getCachedPdfBytes } = await import('../pdf/loader.js');
  const bytes = (getCachedPdfBytes(path) || await pdf.getData()).slice();
  if (bytes.length > 50 * 1024 * 1024) throw new Error('SIZE_LIMIT');
  for (const f of request.fields || []) {
    if (!Number.isInteger(f.page) || f.page < 1 || f.page > pdf.numPages) throw new Error('INVALID_FIELD');
    const v = (await pdf.getPage(f.page)).getViewport({ scale: 1 });
    if (f.x + f.width > v.width || f.y + f.height > v.height) throw new Error('FIELD_OUTSIDE_PAGE');
  }
  if (getActiveDocument() !== doc || doc.pdfDoc !== pdf || documentRevisie(doc) !== revision || contentChanged(doc)) throw new Error('SOURCE_CHANGED');
  const record = await coreFor(doc, { origin }).prepare(request, { bytes, name: path?.split(/[\\/]/).pop() || 'document.pdf', pages: pdf.numPages });
  return { record, containsApprovalData: containsApprovalData(bytes) };
}

async function handle(request, origin) {
  checkAutomationRequest(request, origin);
  const actor = actorFor(origin), doc = getActiveDocument(), core = coreFor(doc, { origin });
  switch (request.action) {
    case 'list': return approvalState(doc);
    case 'configure': {
      if (!PROVIDERS.includes(request.adapter) || typeof request.enabled !== 'boolean') throw new Error('EXPLICIT_ADAPTER_REQUIRED');
      const p = prefs(), providers = { ...(p.providers || {}), [request.adapter]: request.enabled };
      persist({ ...p, providers, ...(request.adapter === 'local-file-v1' ? { enabled: request.enabled } : {}) });
      return approvalState(doc);
    }
    case 'draft': return draft(request, origin);
    case 'preview': {
      const result = await core.preview(request.id);
      const bytes = await core.attachmentBytes(request.id).catch(() => null);
      return { ...result, available: !!bytes, containsApprovalData: bytes ? containsApprovalData(bytes) : false };
    }
    case 'submit': return core.submit(request.id, { confirmedHash: request.confirmedHash, actor });
    case 'match': return { matches: await core.matchReturned(request.bytes, request.name || '') };
    case 'decision': {
      const result = await core.recordDecision(request.id, {
        recipientId: request.recipientId, decision: request.decision, comment: request.comment || '',
        copy: request.copy || null, confirmReference: request.confirmReference === true, actor,
      });
      const attachment = result.kept && doc ? await keepAsAttachment(doc, result.record, result.kept, request.copy.bytes) : null;
      return { ...result, attachment };
    }
    case 'verify': return verifyRequest(request.record);
    case 'createReceipt': {
      if (!doc?.pdfDoc || contentChanged(doc)) throw new Error('OPEN_SAVED_SOURCE');
      const { getCachedPdfBytes } = await import('../pdf/loader.js');
      const bytes = getCachedPdfBytes(doc.saveTargetPath || doc.filePath) || await doc.pdfDoc.getData();
      return { receipt: await makeReceipt(request.record, bytes, request.recipientId, request.decision, request.comment || '') };
    }
    case 'receipt': return core.importReceipt(request.id, request.receipt, origin ? actor : undefined);
    case 'cancel': return core.cancel(request.id, actor);
    case 'supersede': return core.supersede(request.id, request.replacementId, actor);
    case 'export': {
      if (!isTauri() || typeof request.outputPath !== 'string' || !request.outputPath.endsWith('.zip')) throw new Error('DESKTOP_ZIP_PATH_REQUIRED');
      if (await fileExists(request.outputPath)) throw new Error('OUTPUT_EXISTS');
      const result = await core.exportPackage(request.id);
      await writeBinaryFileNew(request.outputPath, result.bytes);
      return { path: request.outputPath, state: result.state, complete: result.complete };
    }
    default: throw new Error('INVALID_ACTION');
  }
}

/** origin: 'mcp' of 'plugin' voor automatisering; de dialoog geeft niets mee. */
export function approvalRequest(request, { origin } = {}) {
  const result = pending.then(() => handle(request, origin));
  pending = result.catch(() => {});
  return result;
}

/** Bytes van de bijlage van de volgende verzending (paginavoorvertoning). */
export function approvalDocument(id) {
  return coreFor(getActiveDocument()).attachmentBytes(id);
}

/** Audit- en documentpakket als download of gekozen bestand (dialoog). */
export async function approvalPackage(id) {
  const result = await coreFor(getActiveDocument()).exportPackage(id);
  const path = await saveOrDownload(`approval-audit [${requestRef(id)}].zip`, result.bytes);
  return { ...result, path };
}

export async function renderApprovalPreview(record, bytes, pageNumber, canvas, { attachmentHash = record.config.source.hash } = {}) {
  await verifyRequest(record);
  if (await digest(bytes) !== attachmentHash) throw new Error('DOCUMENT_HASH_MISMATCH');
  const pdfjs = await import('pdfjs-dist');
  await import('../pdf/loader.js');
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const pdf = await task.promise, page = await pdf.getPage(pageNumber), base = page.getViewport({ scale: 1 }), viewport = page.getViewport({ scale: Math.min(1, 900 / Math.max(base.width, base.height)) });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    for (const f of record.config.fields.filter((f) => f.page === pageNumber)) {
      ctx.strokeStyle = f.kind === 'signature' || f.kind === 'initials' ? '#2563eb' : '#ef4444';
      ctx.lineWidth = 2;
      ctx.strokeRect(f.x * viewport.scale, f.y * viewport.scale, f.width * viewport.scale, f.height * viewport.scale);
    }
    ctx.restore();
  } finally {
    await task.destroy();
  }
}

export { makeReceipt, verifyRequest };
