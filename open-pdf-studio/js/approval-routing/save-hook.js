// Goedkeuringsroutes (#651) bij opslaan (saver.js), vlak voor het schrijven.
//
// Een echte save van een inhoudelijk gewijzigd document vervangt de lopende
// aanvragen (supersede, reden document-changed): ze gingen over een oudere
// versie. Verlopen aanvragen krijgen hun gebeurtenis in de geschiedenis.
// Daarna gaan de aanvragen mee in het bestand. Een herstelmomentopname of
// "alles vlakken" (snapshot) verandert geen toestand, maar schrijft wel mee.
// Een document waarvan de aanvragen nog niet gelezen zijn (doc.goedkeuringen
// ontbreekt) laat de sleutel in het bestand ongemoeid.
//
// Bewust zonder service.js: geen voorkeuren, providers of schermonderdelen
// in de saver; alleen de aanvragen van dit document.

import { createApprovalCore } from './core.js';
import { contentChanged, writeApprovalRequests } from './document-store.js';

function documentStore(doc) {
  const list = () => (Array.isArray(doc.goedkeuringen) ? doc.goedkeuringen : []);
  const copy = (value) => JSON.parse(JSON.stringify(value));
  return {
    entries: () => list().map((e) => ({ record: e.record, kept: e.kept || [], where: 'document' })),
    find: (id) => list().map((e) => ({ record: e.record, kept: e.kept || [] })).find((e) => e.record?.id === id),
    add: () => { throw new Error('READ_ONLY'); },
    // Eén nieuwe lijst toewijzen (het document bewaart een kopie); niet als
    // gewijzigd markeren: deze save schrijft het meteen weg.
    put: (e) => { doc.goedkeuringen = list().map((x) => (x.record.id === e.record.id ? { record: copy(e.record), kept: copy(e.kept || []) } : copy(x))); },
  };
}

export async function approvalBeforeSave(pdfDocLib, doc, { snapshot = false, now } = {}) {
  if (!doc || !Array.isArray(doc.goedkeuringen)) return { superseded: [], expired: [] };
  let superseded = [], expired = [];
  if (!snapshot && doc.goedkeuringen.length) {
    const core = createApprovalCore({ store: documentStore(doc), sources: { put: async () => {}, get: async () => null }, providers: {}, ...(now ? { now } : {}) });
    try {
      if (contentChanged(doc)) superseded = await core.supersedeChanged('Local operator');
      expired = await core.recordExpiry('Local operator');
    } catch (e) {
      console.warn('[approval] status update before save failed:', e?.message || e);
    }
  }
  writeApprovalRequests(pdfDocLib, doc.goedkeuringen);
  return { superseded, expired };
}
