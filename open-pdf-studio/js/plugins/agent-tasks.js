/**
 * Agenttaken voor extensies (#556).
 *
 * Een extensie dient een gestructureerde taak in (bijvoorbeeld "herken de
 * plattegrond op deze pagina") en een MCP-agent pakt hem op en levert een
 * gestructureerd resultaat terug, zonder dat er een chatbericht ontstaat. Een
 * wachtrij die de agent via de MCP-server van de app leegt, per taak met een
 * eigen id, een eigen resultaatkanaal en de identiteit van het document
 * vastgelegd.
 *
 *   extensie                         host (dit register)           MCP-agent
 *   submitAgentTask(...) ──────────► pending ──── app_agent_task_pending ──►
 *                                    running ◄─── app_agent_task_result ────
 *   task.result / onStatus ◄──────── completed | failed | cancelled
 *   task.applyAnnotationBatch(ops) ─► één ongedaan-maakstap, alleen als het
 *                                     document nog hetzelfde is
 *
 * Uitgangspunten:
 *   - De taak legt bij indienen vast: document-id, pagina, bron-vingerafdruk,
 *     paginarotatie en schaal. Wijkt daar iets van af (tabblad gewisseld of
 *     gesloten, bron of pagina veranderd, schaal veranderd), dan wordt een
 *     openstaande taak geannuleerd en een laat resultaat geweigerd.
 *   - De agent krijgt alleen de taak zelf: de contextvelden die de extensie
 *     meegeeft en het resultaatschema. Geen gesprek, geen bestandsnaam, geen
 *     andere taken.
 *   - Een resultaat moet aan het resultaatschema voldoen; onbekende velden
 *     worden geweigerd. Het blijft een voorstel: er verandert niets in het
 *     document tot de extensie het zelf toepast.
 *   - Een taak gaat alleen naar een MCP-agent. Er wordt nooit stil
 *     doorgeschakeld naar een andere aanbieder, en nooit vanzelf opnieuw
 *     geprobeerd: opnieuw proberen is een nieuwe taak indienen.
 *   - Uitladen van de extensie haalt eerst haar luisteraars weg en annuleert
 *     daarna alles wat nog openstaat.
 *
 * Zuivere module: de documentidentiteit en het toepassen komen van een
 * ingespoten host (plugin-api.js), zodat de regels onder node:test draaien.
 *
 * Host:
 *   identiteit(documentId, page) → null | { open, actief, pageCount,
 *     sourceFingerprint, pageRotation, scale, scaleSignature }
 *   annotatiePagina(documentId, annotationId) → number | null
 *   toepassen(documentId, operations) → { createdIds, updatedIds, deletedIds }
 */

import { assertSerializable } from './annotation-batch.js';

export const STATUSSEN = Object.freeze(['pending', 'running', 'completed', 'failed', 'cancelled']);

const SOORT = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const CONTEXT_SLEUTEL = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FOUTCODE_AGENT = /^[A-Za-z0-9_.-]{1,64}$/;
const VELDEN_VERZOEK = new Set(['kind', 'documentId', 'page', 'context', 'resultSchema', 'signal', 'timeoutMs', 'requireScale']);

const STANDAARD_TIJDGRENS_MS = 600_000;
const MIN_TIJDGRENS_MS = 1_000;
const MAX_TIJDGRENS_MS = 3_600_000;
const MAX_OPEN_PER_EXTENSIE = 8;
const MAX_CONTEXT_SLEUTELS = 64;
const MAX_CONTEXT_BYTES = 256 * 1024;
const MAX_SCHEMA_BYTES = 32 * 1024;
const MAX_SCHEMA_DIEPTE = 12;
const MAX_SCHEMA_KNOPEN = 500;
const MAX_RESULTAAT_BYTES = 1024 * 1024;
const MAX_POGINGEN = 3;
const MAX_MELDINGEN = 20;
const MAX_BEWERKINGEN = 5_000;
const BESCHIKBAAR_VENSTER_MS = 30_000;
const MAX_AFGEROND = 100;

/** Fout van de agenttaak-API; `code` is machineleesbaar. */
export class AgentTaskError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AgentTaskError';
    this.code = code;
    if (details && typeof details === 'object') Object.assign(this, details);
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const kloon = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const bytes = (json) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length);

// ─── Resultaatschema ────────────────────────────────────────────────────────
// Een strikte deelverzameling van JSON Schema. Een sleutelwoord dat de host
// niet controleert, wordt geweigerd: anders denkt de extensie dat iets wordt
// gecontroleerd wat stil wordt overgeslagen.

const TYPEN = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);
const SCHEMA_WOORDEN = new Set(['type', 'description', 'title', 'properties', 'required', 'additionalProperties',
  'items', 'enum', 'const', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']);
const isPrimitief = (v) => v === null || typeof v === 'string' || typeof v === 'boolean'
  || (typeof v === 'number' && Number.isFinite(v));
const isTelling = (v) => Number.isInteger(v) && v >= 0;

function typenVan(schema) {
  if (schema.type === undefined) return null;
  return Array.isArray(schema.type) ? schema.type : [schema.type];
}

/** Gooit een AgentTaskError INVALID_SCHEMA bij een schema dat de host niet volledig kan controleren. */
export function controleerResultaatSchema(schema) {
  const fout = (pad, bericht) => new AgentTaskError('INVALID_SCHEMA', `resultSchema${pad}: ${bericht}`);
  let knopen = 0;
  const loop = (s, pad, diepte) => {
    if (++knopen > MAX_SCHEMA_KNOPEN) throw fout('', `more than ${MAX_SCHEMA_KNOPEN} schema nodes`);
    if (diepte > MAX_SCHEMA_DIEPTE) throw fout(pad, `nested deeper than ${MAX_SCHEMA_DIEPTE} levels`);
    if (!isObject(s)) throw fout(pad, 'must be an object');
    for (const k of Object.keys(s)) if (!SCHEMA_WOORDEN.has(k)) throw fout(pad, `unsupported keyword "${k}"`);
    const typen = typenVan(s);
    if (!typen || !typen.length || !typen.every((t) => TYPEN.has(t)) || new Set(typen).size !== typen.length) {
      throw fout(pad, `type must be one or more of ${[...TYPEN].join(', ')}`);
    }
    for (const k of ['description', 'title']) {
      if (s[k] !== undefined && (typeof s[k] !== 'string' || s[k].length > 2000)) throw fout(pad, `${k} must be a string`);
    }
    if (s.properties !== undefined) {
      if (!typen.includes('object') || !isObject(s.properties)) throw fout(pad, 'properties needs type object and an object value');
      for (const [naam, kind] of Object.entries(s.properties)) loop(kind, `${pad}.properties.${naam}`, diepte + 1);
    }
    if (s.required !== undefined) {
      if (!typen.includes('object') || !Array.isArray(s.required) || !s.required.every((r) => typeof r === 'string')) {
        throw fout(pad, 'required must be a list of property names');
      }
      for (const r of s.required) {
        if (!s.properties || !Object.hasOwn(s.properties, r)) throw fout(pad, `required field "${r}" is not in properties`);
      }
    }
    if (s.additionalProperties !== undefined) {
      if (!typen.includes('object')) throw fout(pad, 'additionalProperties needs type object');
      if (typeof s.additionalProperties !== 'boolean') loop(s.additionalProperties, `${pad}.additionalProperties`, diepte + 1);
    }
    if (s.items !== undefined) {
      if (!typen.includes('array')) throw fout(pad, 'items needs type array');
      loop(s.items, `${pad}.items`, diepte + 1);
    }
    if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length || s.enum.length > 100 || !s.enum.every(isPrimitief))) {
      throw fout(pad, 'enum must be a list of 1-100 strings, numbers, booleans or null');
    }
    if (s.const !== undefined && !isPrimitief(s.const)) throw fout(pad, 'const must be a string, number, boolean or null');
    for (const k of ['minimum', 'maximum']) {
      if (s[k] !== undefined && !(typeof s[k] === 'number' && Number.isFinite(s[k]))) throw fout(pad, `${k} must be a finite number`);
    }
    for (const k of ['minLength', 'maxLength', 'minItems', 'maxItems']) {
      if (s[k] !== undefined && !isTelling(s[k])) throw fout(pad, `${k} must be a non-negative integer`);
    }
  };
  if (!isObject(schema)) throw fout('', 'must be an object');
  const json = JSON.stringify(schema);
  if (bytes(json) > MAX_SCHEMA_BYTES) throw fout('', `larger than ${MAX_SCHEMA_BYTES / 1024} KB`);
  loop(schema, '', 0);
  if (typenVan(schema).length !== 1 || schema.type !== 'object') throw fout('', 'the root must have type "object"');
}

function typeVanWaarde(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function past(typen, waarde) {
  const t = typeVanWaarde(waarde);
  return typen.includes(t) || (t === 'integer' && typen.includes('number'));
}

/** De meldingen voor `waarde` tegen een gecontroleerd schema; leeg = geldig. */
export function toetsResultaat(schema, waarde) {
  const meldingen = [];
  const meld = (pad, bericht) => { if (meldingen.length < MAX_MELDINGEN) meldingen.push(`${pad}: ${bericht}`); };
  const loop = (s, w, pad) => {
    if (meldingen.length >= MAX_MELDINGEN) return;
    const typen = typenVan(s);
    if (!past(typen, w)) { meld(pad, `expected ${typen.join(' or ')}, got ${typeVanWaarde(w)}`); return; }
    if (s.enum && !s.enum.some((e) => e === w)) meld(pad, `must be one of ${JSON.stringify(s.enum)}`);
    if (s.const !== undefined && s.const !== w) meld(pad, `must be ${JSON.stringify(s.const)}`);
    if (typeof w === 'number') {
      if (s.minimum !== undefined && w < s.minimum) meld(pad, `must be at least ${s.minimum}`);
      if (s.maximum !== undefined && w > s.maximum) meld(pad, `must be at most ${s.maximum}`);
    } else if (typeof w === 'string') {
      if (s.minLength !== undefined && w.length < s.minLength) meld(pad, `must be at least ${s.minLength} characters`);
      if (s.maxLength !== undefined && w.length > s.maxLength) meld(pad, `must be at most ${s.maxLength} characters`);
    } else if (Array.isArray(w)) {
      if (s.minItems !== undefined && w.length < s.minItems) meld(pad, `must have at least ${s.minItems} items`);
      if (s.maxItems !== undefined && w.length > s.maxItems) meld(pad, `must have at most ${s.maxItems} items`);
      if (s.items) w.forEach((item, i) => loop(s.items, item, `${pad}[${i}]`));
    } else if (isObject(w)) {
      const eigen = s.properties || {};
      for (const r of s.required || []) if (!Object.hasOwn(w, r)) meld(pad, `missing required field "${r}"`);
      for (const [k, v] of Object.entries(w)) {
        if (Object.hasOwn(eigen, k)) loop(eigen[k], v, `${pad}.${k}`);
        else if (isObject(s.additionalProperties)) loop(s.additionalProperties, v, `${pad}.${k}`);
        // Standaard streng: een veld dat het schema niet noemt, is een fout.
        else if (s.additionalProperties !== true) meld(pad, `unknown field "${k}"`);
      }
    }
  };
  loop(schema, waarde, 'result');
  return meldingen;
}

// ─── Register ───────────────────────────────────────────────────────────────

function maakId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `agt-${uuid}`;
  return `agt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Waarom een vastgelegde identiteit niet meer klopt; null = nog dezelfde. */
function afwijking(vast, nu) {
  if (!nu || !nu.open) return 'DOCUMENT_CLOSED';
  if (!nu.actief) return 'DOCUMENT_SWITCHED';
  if (nu.sourceFingerprint !== vast.sourceFingerprint) return 'SOURCE_CHANGED';
  if (!(vast.page <= nu.pageCount) || nu.pageRotation !== vast.pageRotation) return 'PAGE_CHANGED';
  if (nu.scaleSignature !== vast.scaleSignature) return 'SCALE_CHANGED';
  return null;
}

const REDENEN = {
  DOCUMENT_CLOSED: 'the document was closed',
  DOCUMENT_SWITCHED: 'another document became active',
  SOURCE_CHANGED: 'the document source changed',
  PAGE_CHANGED: 'the page changed (page count or rotation)',
  SCALE_CHANGED: 'the measurement scale changed',
  CANCELLED: 'the task was cancelled',
  EXTENSION_UNLOADED: 'the extension was unloaded',
  TIMEOUT: 'no agent answered before the deadline',
};

/**
 * Maak een takenregister.
 * @param {{ host?: object, klok?: { now: () => number, setTimeout: Function, clearTimeout: Function },
 *   maakId?: () => string }} [opties]
 */
export function maakAgentTaken(opties = {}) {
  let host = opties.host ?? null;
  const klok = opties.klok ?? { now: () => Date.now(), setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) };
  const nieuwId = opties.maakId ?? maakId;
  const open = new Map();          // id -> taak (pending of running), in volgorde van indienen
  const afgerond = new Map();      // id -> { status, code } — voor een nette melding bij een laat antwoord
  const waarnemers = new Set();    // () => void, bij elke statuswissel (plugin-api: het controle-effect)
  let laatstePeiling = 0;

  const meldWijziging = () => { for (const fn of [...waarnemers]) { try { fn(); } catch { /* mag niet storen */ } } };

  function momentopname(taak) {
    return {
      taskId: taak.id, kind: taak.kind, documentId: taak.documentId, page: taak.page,
      status: taak.status, code: taak.code, message: taak.message, attempts: taak.pogingen,
      createdAt: taak.createdAt, updatedAt: taak.updatedAt, deadline: taak.deadline, applied: taak.toegepast,
    };
  }

  function wissel(taak, status, code = null, message = null) {
    taak.status = status;
    taak.code = code;
    taak.message = message;
    taak.updatedAt = klok.now();
    const blik = momentopname(taak);
    for (const fn of [...taak.luisteraars]) {
      try { fn(blik); } catch (e) { console.warn('[agent-tasks] status listener failed', e); }
    }
  }

  // Pending of running → eindstatus. Ruimt timer en afbreeksignaal op.
  function beeindig(taak, status, code, message) {
    if (taak.status !== 'pending' && taak.status !== 'running') return false;
    klok.clearTimeout(taak.timer);
    taak.signal?.removeEventListener?.('abort', taak.opAfbreken);
    open.delete(taak.id);
    afgerond.set(taak.id, { status, code });
    while (afgerond.size > MAX_AFGEROND) afgerond.delete(afgerond.keys().next().value);
    if (status !== 'completed') taak.eigenaar.taken.delete(taak);
    wissel(taak, status, code, message);
    if (status === 'completed') taak.resolve({ taskId: taak.id, result: kloon(taak.resultaat) });
    else {
      const details = { taskId: taak.id, status };
      if (taak.agentCode) details.agentCode = taak.agentCode;
      taak.reject(new AgentTaskError(code, `agent task ${taak.id} ${status}: ${message}`, details));
    }
    meldWijziging();
    return true;
  }

  function annuleer(taak, code) {
    return beeindig(taak, 'cancelled', code, REDENEN[code] || code);
  }

  /** Klopt het document van deze taak nog? Annuleert anders. Geeft de reden of null. */
  function controleerTaak(taak) {
    const reden = afwijking(taak.vast, host?.identiteit(taak.documentId, taak.page));
    if (reden) annuleer(taak, reden);
    return reden;
  }

  function controleerAlles() {
    let n = 0;
    for (const taak of [...open.values()]) if (controleerTaak(taak)) n++;
    return n;
  }

  function telOpen(eigenaar) {
    let n = 0;
    for (const t of eigenaar.taken) if (t.status === 'pending' || t.status === 'running') n++;
    return n;
  }

  function controleerVerzoek(verzoek, eigenaar) {
    const ongeldig = (bericht) => new AgentTaskError('INVALID_ARGUMENT', bericht);
    if (!isObject(verzoek)) throw ongeldig('submitAgentTask needs an object');
    for (const k of Object.keys(verzoek)) if (!VELDEN_VERZOEK.has(k)) throw ongeldig(`unknown field "${k}"`);
    const { kind, documentId, page, context = {}, resultSchema, signal, timeoutMs = STANDAARD_TIJDGRENS_MS, requireScale = false } = verzoek;
    if (typeof kind !== 'string' || !SOORT.test(kind)) throw ongeldig(`kind must match ${SOORT}`);
    if (!((typeof documentId === 'string' && documentId) || (typeof documentId === 'number' && Number.isFinite(documentId)))) {
      throw ongeldig('documentId must be the id from getDocumentInfo()');
    }
    if (!Number.isInteger(page) || page < 1) throw ongeldig('page must be a 1-based page number');
    if (!isObject(context)) throw ongeldig('context must be a plain object');
    const sleutels = Object.keys(context);
    if (sleutels.length > MAX_CONTEXT_SLEUTELS) throw ongeldig(`context has more than ${MAX_CONTEXT_SLEUTELS} fields`);
    for (const k of sleutels) if (!CONTEXT_SLEUTEL.test(k)) throw ongeldig(`context field "${k}" must match ${CONTEXT_SLEUTEL}`);
    try { assertSerializable(context, 'context'); } catch (e) { throw ongeldig(e.message); }
    if (bytes(JSON.stringify(context)) > MAX_CONTEXT_BYTES) throw ongeldig(`context is larger than ${MAX_CONTEXT_BYTES / 1024} KB`);
    try { assertSerializable(resultSchema, 'resultSchema'); } catch (e) { throw new AgentTaskError('INVALID_SCHEMA', e.message); }
    controleerResultaatSchema(resultSchema);
    if (signal !== undefined && (signal === null || typeof signal.aborted !== 'boolean' || typeof signal.addEventListener !== 'function')) {
      throw ongeldig('signal must be an AbortSignal');
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs < MIN_TIJDGRENS_MS || timeoutMs > MAX_TIJDGRENS_MS) {
      throw ongeldig(`timeoutMs must be an integer from ${MIN_TIJDGRENS_MS} to ${MAX_TIJDGRENS_MS}`);
    }
    if (typeof requireScale !== 'boolean') throw ongeldig('requireScale must be a boolean');
    if (signal?.aborted) throw new AgentTaskError('CANCELLED', 'the signal was already aborted');
    if (!host) throw new AgentTaskError('NOT_AVAILABLE', 'agent tasks are not available');
    if (telOpen(eigenaar) >= MAX_OPEN_PER_EXTENSIE) {
      throw new AgentTaskError('TOO_MANY_TASKS', `an extension can have at most ${MAX_OPEN_PER_EXTENSIE} pending or running agent tasks`);
    }
    const nu = host.identiteit(documentId, page);
    if (!nu || !nu.open) throw new AgentTaskError('DOCUMENT_NOT_FOUND', 'no open document has this id');
    if (!nu.actief) throw new AgentTaskError('DOCUMENT_NOT_ACTIVE', 'agent tasks can only be submitted for the active document');
    if (page > nu.pageCount) throw new AgentTaskError('INVALID_PAGE', `page ${page} is outside the document (1-${nu.pageCount})`);
    if (requireScale && !nu.scale) throw new AgentTaskError('SCALE_REQUIRED', 'the page has no confirmed measurement scale');
    return { kind, documentId, page, context: kloon(context), resultSchema: kloon(resultSchema), signal, timeoutMs, nu };
  }

  // Het handvat dat de extensie terugkrijgt.
  function handvat(taak) {
    return {
      taskId: taak.id,
      kind: taak.kind,
      documentId: taak.documentId,
      page: taak.page,
      result: taak.belofte,
      get status() { return taak.status; },
      snapshot: () => momentopname(taak),
      onStatus(fn) {
        if (typeof fn !== 'function') throw new AgentTaskError('INVALID_ARGUMENT', 'onStatus needs a function');
        if (taak.ingetrokken) return () => {};
        taak.luisteraars.add(fn);
        return () => taak.luisteraars.delete(fn);
      },
      cancel: () => annuleer(taak, 'CANCELLED'),
      applyAnnotationBatch: (operations) => pasToe(taak, operations),
    };
  }

  function pasToe(taak, operations) {
    if (taak.ingetrokken) throw new AgentTaskError('EXTENSION_UNLOADED', 'the extension that submitted this task was unloaded', { taskId: taak.id });
    if (taak.status !== 'completed') {
      throw new AgentTaskError('TASK_NOT_COMPLETED', `agent task ${taak.id} is ${taak.status}`, { taskId: taak.id, status: taak.status });
    }
    if (taak.toegepast) throw new AgentTaskError('ALREADY_APPLIED', `agent task ${taak.id} was already applied`, { taskId: taak.id });
    // Het document wordt nu opnieuw gecontroleerd: een laat resultaat raakt
    // nooit een ander document, een andere bron of een andere schaal.
    const reden = afwijking(taak.vast, host.identiteit(taak.documentId, taak.page));
    if (reden) {
      throw new AgentTaskError('STALE_TASK', `agent task ${taak.id} is stale: ${REDENEN[reden]}`, { taskId: taak.id, reason: reden });
    }
    const ongeldig = (bericht) => new AgentTaskError('INVALID_OPERATION', bericht, { taskId: taak.id });
    if (!Array.isArray(operations) || !operations.length || operations.length > MAX_BEWERKINGEN) {
      throw ongeldig(`operations must be a list of 1-${MAX_BEWERKINGEN} operations`);
    }
    // Alles blijft op de pagina van de taak.
    for (const op of operations) {
      if (op?.op === 'create') {
        if (op.annotation?.page !== taak.page) throw ongeldig(`a created annotation must be on page ${taak.page}`);
      } else if (op?.op === 'update' || op?.op === 'delete') {
        if (op.op === 'update' && isObject(op.changes) && Object.hasOwn(op.changes, 'page')) {
          throw ongeldig('an agent task batch cannot move annotations to another page');
        }
        const p = host.annotatiePagina(taak.documentId, op.id);
        if (p !== null && p !== undefined && p !== taak.page) throw ongeldig(`annotation ${op.id} is not on page ${taak.page}`);
      }
    }
    const uitkomst = host.toepassen(taak.documentId, operations);
    taak.toegepast = true;
    taak.eigenaar.taken.delete(taak);
    wissel(taak, 'completed');
    return uitkomst;
  }

  return {
    /** De host met documentidentiteit en toepassen (plugin-api.js zet hem één keer). */
    zetHost(h) { host = h; },
    heeftHost: () => Boolean(host),

    /** Eén eigenaar per API-exemplaar: zo ruimt een oude API na herladen alleen haar eigen taken op. */
    maakEigenaar(extensionId) {
      return { extensionId: String(extensionId), taken: new Set(), actief: true };
    },

    /** submitAgentTask: valideert, legt de identiteit vast en zet de taak in de wachtrij. */
    dienIn(eigenaar, verzoek) {
      if (!eigenaar?.actief) throw new AgentTaskError('EXTENSION_INACTIVE', `extension ${eigenaar?.extensionId} is no longer active`);
      const v = controleerVerzoek(verzoek, eigenaar);
      const nu = klok.now();
      const taak = {
        id: nieuwId(), eigenaar, kind: v.kind, documentId: v.nu.documentId ?? v.documentId, page: v.page,
        vast: { page: v.page, sourceFingerprint: v.nu.sourceFingerprint, pageRotation: v.nu.pageRotation, scaleSignature: v.nu.scaleSignature },
        document: {
          id: v.nu.documentId ?? v.documentId, page: v.page, pageCount: v.nu.pageCount,
          sourceFingerprint: v.nu.sourceFingerprint, pageRotation: v.nu.pageRotation, scale: kloon(v.nu.scale ?? null),
        },
        context: v.context, resultSchema: v.resultSchema,
        status: 'pending', code: null, message: null, pogingen: 0,
        createdAt: nu, updatedAt: nu, deadline: nu + v.timeoutMs,
        resultaat: undefined, toegepast: false, ingetrokken: false, agentCode: null,
        luisteraars: new Set(), signal: v.signal, opAfbreken: null, timer: null,
      };
      taak.belofte = new Promise((resolve, reject) => { taak.resolve = resolve; taak.reject = reject; });
      // Een extensie die de belofte negeert, krijgt geen onafgehandelde afwijzing.
      taak.belofte.catch(() => {});
      taak.timer = klok.setTimeout(() => beeindig(taak, 'failed', 'TIMEOUT', REDENEN.TIMEOUT), v.timeoutMs);
      taak.timer?.unref?.();
      if (v.signal) {
        taak.opAfbreken = () => annuleer(taak, 'CANCELLED');
        v.signal.addEventListener('abort', taak.opAfbreken, { once: true });
      }
      open.set(taak.id, taak);
      eigenaar.taken.add(taak);
      meldWijziging();
      return handvat(taak);
    },

    /** Controleer alle openstaande taken tegen het document; annuleert wat niet meer klopt. */
    controleer: controleerAlles,

    /**
     * Uitladen (#550): eerst de luisteraars weg, dan alles van deze eigenaar
     * annuleren en voltooide, nog niet toegepaste resultaten intrekken.
     */
    ruimOp(eigenaar) {
      if (!eigenaar) return;
      eigenaar.actief = false;
      for (const taak of [...eigenaar.taken]) {
        taak.luisteraars.clear();
        taak.ingetrokken = true;
        annuleer(taak, 'EXTENSION_UNLOADED');
      }
      eigenaar.taken.clear();
    },

    /** Is er een MCP-agent die taken ophaalt? Wordt nooit naar een andere aanbieder omgeleid. */
    beschikbaarheid() {
      let pending = 0;
      let running = 0;
      for (const t of open.values()) { if (t.status === 'pending') pending++; else running++; }
      const leeftijd = laatstePeiling ? klok.now() - laatstePeiling : null;
      return { available: leeftijd !== null && leeftijd < BESCHIKBAAR_VENSTER_MS, lastPollAgeMs: leeftijd, pending, running };
    },

    /** app_agent_task_pending: de oudste wachtende taak (eventueel van één soort) gaat naar running. */
    neemOp(params = {}) {
      const p = params ?? {};
      if (!isObject(p)) return { ok: false, code: 'INVALID_ARGUMENT', error: 'arguments must be an object' };
      for (const k of Object.keys(p)) if (k !== 'kind') return { ok: false, code: 'INVALID_ARGUMENT', error: `unknown argument: ${k}` };
      if (p.kind !== undefined && (typeof p.kind !== 'string' || !SOORT.test(p.kind))) {
        return { ok: false, code: 'INVALID_ARGUMENT', error: `kind must match ${SOORT}` };
      }
      laatstePeiling = klok.now();
      controleerAlles();
      const wachtend = [...open.values()].filter((t) => t.status === 'pending' && (p.kind === undefined || t.kind === p.kind));
      const taak = wachtend[0];
      if (!taak) return { ok: true, task: null, waiting: 0 };
      wissel(taak, 'running');
      meldWijziging();
      return {
        ok: true,
        task: {
          id: taak.id, kind: taak.kind, extensionId: taak.eigenaar.extensionId,
          document: kloon(taak.document), context: kloon(taak.context), resultSchema: kloon(taak.resultSchema),
          createdAt: taak.createdAt, deadline: taak.deadline, attemptsLeft: MAX_POGINGEN - taak.pogingen,
        },
        waiting: wachtend.length - 1,
      };
    },

    /** app_agent_task_result: een resultaat of fout voor precies deze taak. */
    lever(params) {
      const ongeldig = (error) => ({ ok: false, code: 'INVALID_ARGUMENT', error });
      if (!isObject(params)) return ongeldig('arguments must be an object with id and result or error');
      for (const k of Object.keys(params)) if (!['id', 'result', 'error'].includes(k)) return ongeldig(`unknown argument: ${k}`);
      const { id } = params;
      if (typeof id !== 'string' || !id || id.length > 128) return ongeldig('id must be a task id from app_agent_task_pending');
      const heeftResultaat = Object.hasOwn(params, 'result');
      if (heeftResultaat === Object.hasOwn(params, 'error')) return ongeldig('give either result or error');
      const taak = open.get(id);
      if (!taak) {
        const klaar = afgerond.get(id);
        return klaar
          ? { ok: false, code: 'TASK_NOT_RUNNING', id, status: klaar.status, reason: klaar.code, error: `task ${id} is ${klaar.status}` }
          : { ok: false, code: 'UNKNOWN_TASK', id, error: `unknown task id: ${id}` };
      }
      if (taak.status !== 'running') {
        return { ok: false, code: 'TASK_NOT_CLAIMED', id, error: 'take the task with app_agent_task_pending first' };
      }
      const reden = controleerTaak(taak);
      if (reden) return { ok: false, code: 'STALE_TASK', id, status: 'cancelled', reason: reden, error: `task ${id} was cancelled: ${REDENEN[reden]}` };

      if (!heeftResultaat) {
        const e = params.error;
        if (!isObject(e) || Object.keys(e).some((k) => k !== 'code' && k !== 'message')
            || typeof e.message !== 'string' || !e.message.trim() || e.message.length > 2000
            || (e.code !== undefined && (typeof e.code !== 'string' || !FOUTCODE_AGENT.test(e.code)))) {
          return ongeldig('error must be { message, code? } with a message of at most 2000 characters');
        }
        taak.agentCode = e.code ?? null;
        beeindig(taak, 'failed', 'AGENT_ERROR', e.code ? `${e.code}: ${e.message}` : e.message);
        return { ok: true, id, status: 'failed' };
      }

      let json;
      try { json = JSON.stringify(params.result); } catch { json = undefined; }
      let meldingen;
      let waarde;
      if (json === undefined) meldingen = ['result: must be JSON data'];
      else if (bytes(json) > MAX_RESULTAAT_BYTES) meldingen = [`result: larger than ${MAX_RESULTAAT_BYTES / 1024} KB`];
      else {
        waarde = JSON.parse(json);
        meldingen = toetsResultaat(taak.resultSchema, waarde);
      }
      if (meldingen.length) {
        taak.pogingen++;
        const over = MAX_POGINGEN - taak.pogingen;
        if (over <= 0) {
          beeindig(taak, 'failed', 'INVALID_RESULT', `the result did not match the schema ${MAX_POGINGEN} times`);
          return { ok: false, code: 'INVALID_RESULT', id, status: 'failed', errors: meldingen, attemptsLeft: 0, error: 'the result does not match the resultSchema; the task failed' };
        }
        meldWijziging();
        return { ok: false, code: 'INVALID_RESULT', id, status: 'running', errors: meldingen, attemptsLeft: over, error: 'the result does not match the resultSchema; send a corrected result' };
      }
      taak.resultaat = waarde;
      beeindig(taak, 'completed', null, null);
      return { ok: true, id, status: 'completed' };
    },

    /** Voor app_list_extensions en tests: een momentopname van een taak, of null. */
    status(id) {
      const taak = open.get(id);
      if (taak) return momentopname(taak);
      const klaar = afgerond.get(id);
      return klaar ? { taskId: id, status: klaar.status, code: klaar.code } : null;
    },

    /** Luister naar elke statuswissel (voor het controle-effect in plugin-api.js). */
    abonneer(fn) {
      waarnemers.add(fn);
      return () => waarnemers.delete(fn);
    },
  };
}

// Het register van de app: plugin-api.js dient in, de MCP-brug haalt op en levert.
export const agentTaken = maakAgentTaken();

export const handleAgentTaskPending = (params) => agentTaken.neemOp(params);
export const handleAgentTaskResult = (params) => agentTaken.lever(params);
