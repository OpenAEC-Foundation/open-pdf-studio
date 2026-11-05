// Read the app keys of a dynamic stamp (#629) back from a /Stamp dict; see
// pdf/saver/dynamic-stamp-ap.js. Only pdf-lib: testable in node.
//
// The JSON comes from a file, so it goes through the same validation as an
// imported template (normalizeDynamicStamp). Anything unreadable gives null:
// the stamp then loads as a plain text stamp from its appearance text.

import { PDFName, PDFBool } from 'pdf-lib';
import { inflateBytes } from './pdf-helpers.js';
import { normalizeDynamicStamp } from '../../annotations/dynamic-stamp.js';

const MAX_JSON = 4_000_000;

export async function readDynamicStamp(context, annotDict) {
  try {
    const raw = annotDict.get(PDFName.of('OPS_DynStamp'));
    if (!raw) return null;
    const stream = context.lookup(raw);
    let bytes = typeof stream?.getContents === 'function' ? stream.getContents() : stream?.contents;
    if (!(bytes instanceof Uint8Array)) return null;
    const filter = stream.dict?.get(PDFName.of('Filter'))?.toString() || '';
    if (filter.includes('/FlateDecode')) bytes = await inflateBytes(bytes);
    else if (filter) return null;
    if (!bytes || bytes.length > MAX_JSON) return null;
    const ds = normalizeDynamicStamp(JSON.parse(new TextDecoder('utf-8').decode(bytes)));
    if (!ds) return null;
    const lockedRaw = annotDict.get(PDFName.of('OPS_StampLocked'));
    const locked = context.lookup(lockedRaw) || lockedRaw;
    if (locked === PDFBool.True || locked?.asBoolean?.() === true) ds.locked = true;
    return ds;
  } catch (_) {
    return null;
  }
}
