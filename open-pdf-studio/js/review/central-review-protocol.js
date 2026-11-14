// Strict boundary for the central server's revision protocol (#1067).
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/;
export const identifier = value => typeof value === 'string' && IDENTIFIER.test(value);
const revision = value => Number.isSafeInteger(value) && value >= 0;
const invalid = () => { throw new Error('INVALID_RESPONSE'); };
const dataValid = (data, id) => data && typeof data === 'object' && !Array.isArray(data) &&
  data.id === id && typeof data.type === 'string' && data.type.length > 0 && Number.isSafeInteger(data.page) && data.page > 0;

export function validateRequest(event) {
  if (!event || Object.keys(event).sort().join(',') !== 'ann,base,data,id,op' ||
      !identifier(event.id) || !identifier(event.ann) || !['create', 'edit', 'delete'].includes(event.op) ||
      (event.op === 'create' ? event.base !== null : !identifier(event.base)) ||
      (event.op === 'delete' ? event.data !== null : !dataValid(event.data, event.ann))) throw new Error('INVALID_REQUEST');
  // Serialize now: retries must never see later edits of the caller's objects.
  const text = JSON.stringify(event, (_, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('INVALID_REQUEST');
    return value;
  });
  if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error('INVALID_REQUEST');
  return JSON.parse(text);
}

export function validateEvent(event) {
  try { validateRequest({ id: event.id, ann: event.ann, op: event.op, base: event.base, data: event.data }); }
  catch { invalid(); }
  if (event.v !== 1 || !revision(event.revision) || event.revision === 0 ||
      event.seq !== event.revision || event.clock !== event.revision || !identifier(event.uk) ||
      typeof event.user !== 'string' || !event.user || typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at))) invalid();
  return structuredClone(event);
}

export function validateSnapshot(body) {
  if (!body || !revision(body.cursor) || !Array.isArray(body.annotations)) invalid();
  const ids = new Set();
  for (const row of body.annotations) {
    if (!row || !identifier(row.id) || !identifier(row.base) || ids.has(row.id) ||
        (row.data !== null && !dataValid(row.data, row.id))) invalid();
    ids.add(row.id);
  }
  if (body.annotations.length > body.cursor) invalid();
  return structuredClone(body);
}

export function validateReplay(body, after, limit) {
  if (!body || !Array.isArray(body.events) || body.events.length > limit ||
      !revision(body.head) || !revision(body.cursor) || body.head < body.cursor ||
      typeof body.hasMore !== 'boolean' || body.hasMore !== (body.cursor < body.head)) invalid();
  let cursor = after;
  const ids = new Set();
  const events = body.events.map(event => {
    const valid = validateEvent(event);
    if (valid.revision !== ++cursor || ids.has(valid.id)) invalid();
    ids.add(valid.id);
    return valid;
  });
  if (body.cursor !== cursor || (body.hasMore && !events.length)) invalid();
  return { events, cursor, head: body.head, hasMore: body.hasMore };
}
